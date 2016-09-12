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
        insertClient(client, function(err, result) {
          if(err && database.isDuplicateError(err)) {
            // Don't fail on duplicates
            return callback();
          }
          callback(err, result);
        });
      }, callback);
    }],
    getClients: ['insertClients', function(callback) {
      api.getAll(null, callback);
    }],
    startClients: ['getClients', function(callback, results) {
      async.each(results.getClients, function(client, callback) {
        // define function to run as job later
        var fn = function(job, callback) {
          var id = client.id;
          async.auto({
            getClient: function(callback) {
              api.get(null, id, callback);
            },
            poll: ['getClient', function(callback, results) {
              var options = {
                job: job,
                client: results.getClient.client
              };
              pollServer(options, callback);
            }]
          }, callback);
        };

        scheduler.define(createJobId(client), fn);

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
    throw new TypeError('"client.id" and "client.interval" must be defined."');
  }
  var jobId = createJobId(client);
  var jobSchedule = {
    id: jobId,
    type: jobId,
    schedule: 'R/PT' + client.interval + 'M',
    priority: 0,
    concurrency: 1
  };
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
api._pollServer = pollServer;

function insertClient(client, callback) {
  var now = Date.now();
  var meta = {};
  meta.created = now;
  meta.updated = now;
  meta.recentPollErrorCount = 0;
  var record = {
    id: database.hash(client.id),
    meta: meta,
    client: client
  };
  database.collections.messageClient.insert(
    record, database.writeOptions, callback);
}

function pollServer(options, callback) {
  var client = options.client;
  var jobId = createJobId(client);
  var pollErrorCount;
  var singleUpdate = bedrock.util.extend(
    {}, database.writeOptions, {upsert: false, multi: false});

  async.auto({
    getClient: function(callback) {
      api.get(null, client.id, function(err, record) {
        pollErrorCount = record.meta.recentPollErrorCount;
        callback(null, record);
      });
    },
    // TODO: Use SSM/HSM to get private key
    getPrivateKey: function(callback) {
      brKey.getPublicKey({id: client.publicKeyId}, null,
        function(err, publicKey, meta, privateKey) {
          if(!privateKey || err) {
            return handlePollServerError({
              client: client,
              jobId: jobId,
              error: new BedrockError(
                'The server could not be contacted: ' + client.endpoint,
                'PollServerError', {},
                err || new Error('Private key not found.')),
              pollErrorCount: pollErrorCount
            }, callback);
          }
          callback(err, privateKey);
        });
    },
    poll: ['getPrivateKey', 'getClient', function(callback, results) {
      request.get({
        url: client.endpoint,
        httpSignature: {
          key: results.getPrivateKey.privateKeyPem,
          keyId: client.publicKeyId,
          headers: ['date', 'host', 'request-line']
        },
        json: true,
        strictSSL: client.strictSSL
      }, function(err, res, body) {
        if(err) {
          return handlePollServerError({
            client: client,
            jobId: jobId,
            error: new BedrockError(
              'The server could not be contacted: ' + client.endpoint,
              'PollServerError', {}, err),
            pollErrorCount: pollErrorCount
          }, callback);
        }
        if(res.statusCode !== 200) {
          return handlePollServerError({
            client: client,
            jobId: jobId,
            error: new BedrockError(
              'The server could not be contacted: ' + client.endpoint,
              'PollServerError', {
                httpStatusCode: res.statusCode,
                details: body
              }),
            pollErrorCount: pollErrorCount
          }, callback);
        }

        database.collections.messageClient.update({
          id: database.hash(client.id)
        }, {
          $set: {'meta.recentPollErrorCount': 0}
        }, singleUpdate, function(err) {
          callback(err, body);
        });
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
      // FIXME: the message content should come from a file or template
      var messages = results.poll.map(function(message) {
        var newMessage = message;
        if(message.type === 'CredentialNotification') {
          // subject and body are ignored if they exist
          newMessage.recipient = newMessage.content.holder;
          newMessage.subject = 'A credential is available for pick-up';
          if(message.content.potentialAction !== null &&
            message.content.potentialAction.length > 0) {
            newMessage.content.body = 'Click <a href="' +
              message.content.potentialAction[0].target.urlTemplate +
              '" target="_blank">this link</a> to accept the credential.';
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
 * Helper function to handle errors in pollServer.
 */
function handlePollServerError(options, callback) {
  var client = options.client;
  var jobId = createJobId(client);
  var error = options.error;
  var pollErrorCount = options.pollErrorCount;
  var maxPollErrorsBeforeNotify =
    config['messages-client'].maxPollErrorsBeforeNotify;

  var singleUpdate = bedrock.util.extend(
    {}, database.writeOptions, {upsert: false, multi: false});

  var pollServerErrorEvent = {
    type: 'messageClient.pollServerError',
    details: {
      endpoint: client.endpoint
    }
  };

  return database.collections.messageClient.update({
    id: database.hash(client.id)
  }, {
    $inc: {'meta.recentPollErrorCount': 1}
  }, singleUpdate, function(err) {
    if(err) {
      return callback(err);
    }
    if(pollErrorCount + 1 === maxPollErrorsBeforeNotify) {
      bedrock.events.emitLater(pollServerErrorEvent);
      if(config['messages-client'].stopPollingAfterNotify) {
        return scheduler.unschedule({id: jobId}, function(err) {
          if(err) {
            return callback(err);
          }
          database.collections.messageClient.update({
            id: database.hash(client.id)
          },
          {$set: {'meta.recentPollErrorCount': 0}},
          singleUpdate, function(err) {
            if(err) {
              return callback(err);
            }
            callback(error);
          });
        });
      }
    }
    return callback(error);
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
 * @param callback(err, record) called once the operation completes.
 *   record.client is the client
 *   record.meta is the meta data
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
      callback(null, record);
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
    restart: ['update', function(callback) {
      api.start(client, callback);
    }]
  }, callback);
};
