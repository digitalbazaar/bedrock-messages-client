/*
 * Bedrock messages-client module.
 *
 * Copyright (c) 2016 Digital Bazaar, Inc. All rights reserved.
 */
 /* jshint node: true */

'use strict';

var async = require('async');
var bedrock = require('bedrock');
var config = bedrock.config;
var BedrockError = bedrock.util.BedrockError;
var brMessages = require('bedrock-messages');
var request = require('request');
var scheduler = require('bedrock-jobs');
var uuid = require('node-uuid').v4;

require('./config');

var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

// configure for tests
bedrock.events.on('bedrock.test.configure', function() {
  require('./test.config');
});

bedrock.events.on('bedrock-mongodb.ready', function(callback) {
  if(!config['messages-client'].enable) {
    return callback();
  }
  var interval = 1;
  config['messages-client'].clients
    .forEach(function(clientOptions) {
      var jobId = createJobId(clientOptions.endpoint);
      var endpoint = clientOptions.endpoint;
      var privateKeyPem = clientOptions.privateKeyPem;
      var publicKeyId = clientOptions.publicKeyId;
      var strictSSL = !('strictSSL' in clientOptions) ?
        true : !!clientOptions.strictSSL;
      var fn = function(job, callback) {
        var options = {
          job: job,
          endpoint: endpoint,
          privateKeyPem: privateKeyPem,
          publicKeyId: publicKeyId,
          strictSSL: strictSSL
        };
        pollServer(options, function(err, results) {
          if(err) {
            return callback(err);
          }
          callback();
        });
      };

      scheduler.define(jobId, fn);

      api.start(endpoint, interval, callback);
    });
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
api.start = function(endpoint, interval, callback) {
  // TODO: Where validation of the interval being equal to 1,5, or 10 be located
  var jobId = createJobId(endpoint);
  var jobSchedule = {
    id: jobId,
    type: jobId,
    schedule: 'R/PT' + interval + 'M',
    priority: 0,
    concurrency: 1
  };

  // TODO: What happens if a job unschedules but doesn't schedule?
  scheduler.unschedule({id: jobId}, function(err) {
    if(err) {
      return callback(new BedrockError(
        'Could not start the client.',
        'UnschedulingFailure',
        {endpoint: endpoint, interval: interval}
      ));
    }

    return scheduler.schedule(jobSchedule, function(err) {
      if(err) {
        return callback(new BedrockError(
          'Could not start the client.',
          'SchedulingFailure',
          {endpoint: endpoint, interval: interval}
        ));
      }

      callback();
    });
  });
};

/*
 * @param endpoint The endpoint used to create the jobId
 */
function createJobId(endpoint) {
  return 'brMessagesClient.getMessages.' + endpoint;
}

// exposed for testing
api._createJobId = createJobId;

// MessageClient class is deprecated

// FIXME: replace private key information with a signing service
// private key should be kept safe
api.MessageClient = function(options) {
  this.endpoint = options.endpoint;
  this.privateKeyPem = options.privateKeyPem;
  this.publicKeyId = options.publicKeyId;
  this.jobId = uuid();
  if(!('strictSSL' in options)) {
    this.strictSSL = true;
  } else {
    this.strictSSL = !!options.strictSSL;
  }
  // TODO: implement this option
  // this.pollInterval = options.pollInterval;
  config.scheduler.jobs.push({
    id: this.jobId,
    type: this.jobId,
    // repeat forever, run every minute
    schedule: 'R/PT1M',
    // no special priority
    priority: 0,
    concurrency: 1
  });
};

api.MessageClient.prototype.start = function() {
  var self = this;
  scheduler.define(self.jobId, function(job, callback) {
    var options = {
      job: job,
      endpoint: self.endpoint,
      privateKeyPem: self.privateKeyPem,
      publicKeyId: self.publicKeyId,
      strictSSL: self.strictSSL
    };
    pollServer(options, function(err, results) {
      if(err) {
        return callback(err);
      }
      callback(null);
    });
  });
};

// exposed for testing
api._pollServer = function(options, callback) {
  pollServer(options, callback);
};

function pollServer(options, callback) {
  async.auto({
    poll: function(callback) {
      request.get({
        url: options.endpoint,
        httpSignature: {
          key: options.privateKeyPem,
          keyId: options.publicKeyId,
          headers: ['date', 'host', 'request-line']
        },
        json: true,
        strictSSL: options.strictSSL
      }, function(err, res, body) {
        if(err) {
          return callback(new BedrockError(
            'The server could not be contacted: ' + options.endpoint,
            'HttpError', {
            httpError: err
          }));
        }
        if(res.statusCode !== 200) {
          // FIXME: fix-up error message
          return callback(new BedrockError(
            'The server responded with an error: ' + options.endpoint,
            'HttpError', {
              statusCode: res.statusCode,
              details: body
            }));
        }
        callback(null, body);
      });
    },
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
