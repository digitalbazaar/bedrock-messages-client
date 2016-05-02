/*
 * Bedrock messages-client module.
 *
 * Copyright (c) 2016 Digital Bazaar, Inc. All rights reserved.
 */
 /* jshint node: true */

'use strict';

var _ = require('lodash');
var async = require('async');
var bedrock = require('bedrock');
var config = bedrock.config;
var BedrockError = bedrock.util.BedrockError;
var brKey = require('bedrock-key');
var brMessages = require('bedrock-messages');
var database = require('bedrock-mongodb');
var request = require('request');
var scheduler = require('bedrock-jobs');
var uuid = require('node-uuid').v4;

var brIdentity = require('bedrock-identity');

var PERMISSIONS = bedrock.config.permission.permissions;

require('./config');

var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

// configure for tests
bedrock.events.on('bedrock.test.configure', function() {
  require('./test.config');
});

// TODO: Need validation on client objects
bedrock.events.on('bedrock-mongodb.ready', function(callback) {
  if(!config['messages-client'].enable) {
    return callback();
  }
  async.auto({
    openCollections: function(callback) {
      database.openCollections(['messageClient'], callback);
    },
    createIndexes: ['openCollections', function(callback) {
      database.createIndexes([{
        collection: 'messageClient',
        fields: {id: 1},
        options: {unique: true, background: false}
      }], callback);
    }],
    insertClients: ['createIndexes', function(callback) {
      var clients = config['messages-client'].clients;
      async.each(clients, function(client, callback) {
        var now = Date.now();
        var meta = {};
        meta.created = now;
        meta.updated = now;
        var record = {
          id: database.hash(client.id),
          meta: meta,
          client: client
        };
        database.collections.messageClient.insert(
        record, database.writeOptions, function(err, result) {
          if(err && database.isDuplicateError(err)) {
            // Don't fail on duplicates
            return callback();
          }
          callback(err);
        });
      }, callback);
    }],
    getClients: ['insertClients', function(callback, results) {
      api.getAll(null, callback);
    }],
    startClients: ['getClients', function(callback, results) {
      var clients = results.getClients;
      console.log("Got clients, defining", clients);
      async.each(clients, function(client, callback) {
        var jobId = createJobId(client);
        var endpoint = client.endpoint;
        var privateKeyPem = client.privateKeyPem;
        var publicKeyId = client.publicKeyId;
        var strictSSL = !('strictSSL' in client) ?
          true : !!client.strictSSL;
        var fn = function(job, callback) {
          var id = client.id;
          async.auto({
            getClient: function(callback) {
              api.get(null, id, function(err, results) {
                callback(err, results);
              });
            },
            poll: ['getClient', function(callback, results) {
              var client = results.getClient;
              var options = {
                job: job,
                client: client
              };
              pollServer(options, callback);
            }]
          }, callback);
        };

        scheduler.define(jobId, fn);

        api.start(client, callback);
      }, callback);
    }]
  }, callback);
});

/*
 * Starts a client that polls the endpoint with the specified interval setting.
 * If a client is already running on the specified endpoint, it will be
 * restarted with the new time interval.
 *
 * @param endpoint the endpoint for the client to poll.
 * @param interval the number of minutes to wait between polling
 * the endpoint (e.g. 1, 5, or 10)
 */
api.start = function(client, callback) {
  if(!client.interval || !client.id) {
    return callback(new BedrockError(
      'Could not start the client.',
      'SchedulingFailure',
      {id: client.id, interval: client.interval}
    ));
  }
  var jobId = createJobId(client);
  var jobSchedule = {
    id: jobId,
    type: jobId,
    schedule: 'R/PT' + client.interval + 'M',
    priority: 0,
    concurrency: 1
  };
  console.log("++++++++++++++++++++++++++++++++++++++++++");
  console.log("Creating client with schedule", jobSchedule);
  // TODO: What happens if a job unschedules but doesn't schedule?
  scheduler.unschedule({id: jobId}, function(err) {
    if(err) {
      return callback(new BedrockError(
        'Could not start the client.',
        'UnschedulingFailure',
        {id: client.id, interval: client.interval}
      ));
    }

    return scheduler.schedule(jobSchedule, function(err) {
      if(err) {
        return callback(new BedrockError(
          'Could not start the client.',
          'SchedulingFailure',
          {id: client.id, interval: client.interval}
        ));
      }

      callback();
    });
  });
};

/*
 * @param client The client used to create the jobId
 */
function createJobId(client) {
  return 'brMessagesClient.getMessages.' + client.id;
}

// exposed for testing
api._createJobId = createJobId;

// exposed for testing
api._pollServer = function(options, callback) {
  pollServer(options, callback);
};

function pollServer(options, callback) {
  console.log("Poll server called with options", options);
  var client = options.client;
  var retries = 0;
  var maxRetries = config['messages-client'].maxMessageRetrievalRetries;
  var failedToRetrieveMessageEvent = {
    type: 'messageClient.failedToRetrieveMessage',
    details: {
      endpoint: client.endpoint
    }
  };
  async.auto({
    getPrivateKey: function(callback) {
      brKey.getPublicKey({id: client.publicKeyId}, null,
        function(err, publicKey, meta, privateKey) {
          if(!privateKey) {
            return callback(new BedrockError(
            'Contacting server with no private key configured: ' +
              client.endpoint,
            'SigningFailure', {statusCode: 400}
            ));
          }
          callback(err, privateKey);
        });
    },
    poll: ['getPrivateKey', function(callback, results) {
      console.log("Private key");
      console.log(results.getPrivateKey);
      console.log("Public key id");
      console.log(client.publicKeyId);
      request.get({
        url: client.endpoint,
        httpSignature: {
          key: results.getPrivateKey,
          keyId: client.publicKeyId,
          headers: ['date', 'host', 'request-line']
        },
        json: true,
        strictSSL: client.strictSSL
      }, function(err, res, body) {
        if(err) {
          retries++;
          // The job will continue to retry contacting the endpoint, but it
          // will only fire off one email event
          if(retries === maxRetries) {
            bedrock.events.emitLater(failedToRetrieveMessageEvent);
          }
          return callback(new BedrockError(
            'The server could not be contacted: ' + client.endpoint,
            'HttpError', {
            httpError: err
          }));
        }
        if(res.statusCode !== 200) {
          retries++;
          // The job will continue to retry contacting the endpoint, but it
          // will only fire off one email event
          if(retries === maxRetries) {
            bedrock.events.emitLater(failedToRetrieveMessageEvent);
          }
          // FIXME: fix-up error message
          return callback(new BedrockError(
            'The server responded with an error: ' + client.endpoint,
            'HttpError', {
              statusCode: res.statusCode,
              details: body
            }));
        }
        callback(null, body);
      });
    }],
    process: ['poll', function(callback, results) {
      if(results.poll.length === 0) {
        return callback();
      }
      // make the content.holder the new recipient
      // FIXME: do some jsonld processing on message
      // FIXME: possibly use template configured by top level module to
      // describe message subject and body
      // FIXME: perform some validation on the link for safety?
      var messages = results.poll.map(function(message) {
        var newMessage = message;
        if(message.type === 'CredentialNotification') {
          // subject and body are ignored if they exist
          newMessage.recipient = newMessage.content.holder;
          newMessage.subject = 'A credential is available for pick-up';
          if(message.content.potentialAction != null &&
            message.content.potentialAction.length > 0) {

            newMessage.content.body = 'Click <a href="' +
              message.content.potentialAction[0].target.urlTemplate +
              '">this link</a> to accept the credential.';
          }
        }
        return newMessage;
      });
      brMessages.store(messages, callback);
    }]
  }, function(err, results) {
    callback(err, results.process);
  });
}

/**
 * Retrieves all clients matching the given query.
 *
 * @param actor the Identity performing the action.
 * @param [query] the optional query to use (default: {}).
 * @param [fields] optional fields to include or exclude (default: {}).
 * @param [options] options (eg: 'sort', 'limit').
 * @param callback(err, records) called once the operation completes.
 */
api.getAll = function(actor, query, fields, options, callback) {
  // handle args
  if(typeof query === 'function') {
    callback = query;
    query = null;
    fields = null;
  } else if(typeof fields === 'function') {
    callback = fields;
    fields = null;
  } else if(typeof options === 'function') {
    callback = options;
    options = null;
  }

  query = query || {};
  fields = fields || {};
  options = options || {};
  async.waterfall([
    function(callback) {
      brIdentity.checkPermission(
        actor, PERMISSIONS.MESSAGE_CLIENT_ADMIN, callback);
    },
    function(callback) {
      database.collections.messageClient.find(
        query, fields, options).toArray(function(err, results) {
          callback(err, _.map(results, 'client'));
        });
    }
  ], callback);
};

/**
 * Retrieves a message client.
 *
 * @param actor the Identity performing the action.
 * @param id the ID of the Client to retrieve.
 * @param callback(err, client, meta) called once the operation completes.
 */
api.get = function(actor, id, callback) {
  async.waterfall([
    function(callback) {
      brIdentity.checkPermission(
        actor, PERMISSIONS.MESSAGE_CLIENT_ADMIN, callback);
    },
    function(callback) {
      database.collections.messageClient.findOne(
        {id: database.hash(id)}, {}, callback);
    },
    function(record, callback) {
      if(!record) {
        return callback(new BedrockError(
          'Client not found.',
          'NotFound',
          {id: id, httpStatusCode: 404, public: true}));
      }
      console.log("Get returning client", record.client);
      callback(null, record.client, record.meta);
    }
  ], callback);
};

api.update = function(actor, client, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = bedrock.util.extend({}, options);
  async.auto({
    checkPermission: function(callback) {
      brIdentity.checkPermission(
        actor, PERMISSIONS.MESSAGE_CLIENT_ADMIN, callback);
    },
    update: ['checkPermission', function(callback) {
      // build a database update
      var update = database.buildUpdate(client, 'client', {
        include: [
          'client.id',
          'client.label',
          'client.endpoint',
          'client.interval',
          'client.publicKeyId',
          'client.strictSSL'
        ]
      });
      database.collections.messageClient.update(
        {id: database.hash(client.id)},
        {$set: update}, database.writeOptions, function(err, results) {
          if(results.result.n === 0) {
            return callback(new BedrockError(
              'Could not update Client. Client not found.',
              'NotFound'));
          }
          callback();
        });
    }],
    restart: ['update', function(callbacK) {
      api.start(client, callback);
    }]
  }, callback);
};
