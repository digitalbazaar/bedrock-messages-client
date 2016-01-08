/*
 * Bedrock messages-client module.
 *
 * Copyright (c) 2015 Digital Bazaar, Inc. All rights reserved.
 */
 /* jshint node: true */

'use strict';

var async = require('async');
var bedrock = require('bedrock');
var BedrockError = bedrock.util.BedrockError;
var brMessages = require('bedrock-messages');
var config = bedrock.config;
var request = require('request');
var scheduler = require('bedrock-jobs');

require('./config');

// configure for tests
bedrock.events.on('bedrock.test.configure', function() {
  require('./test.config');
});

var POLL_SERVERS = 'messages-client.jobs.PollServers';

var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

bedrock.events.on('bedrock.init', function() {
  if(config['messages-client'].enableScheduledJobs) {
    scheduler.define(POLL_SERVERS,
      // FIXME: lockduration not specified
      // {lockDuration: 30000},
      function(job, callback) {
        pollServer(job, callback);
      }
    );
  }
});

// exposed for testing
api._pollServer = function(job, endpoint, identity, callback) {
  pollServer(job, endpoint, identity, callback);
};

function pollServer(job, endpoint, identity, callback) {
  async.auto({
    poll: function(callback) {
      request.post({
        url: endpoint,
        httpSignature: {
          key: identity.keys.privateKey.privateKeyPem,
          keyId: identity.keys.publicKey.id,
          headers: ['date', 'host', 'request-line']
        },
        json: true
      }, function(err, res, body) {
        if(res.statusCode !== 200) {
          // FIXME: fix-up error message
          return callback(new BedrockError(
            'Authentication mismatch. Messages query identity does not match ' +
            'the authenticated user.', 'AuthenticationMismatch', {
            httpStatusCode: 409,
            public: true
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
      var messages = results.poll.map(function(message) {
        var newMessage = message;
        newMessage.recipient = newMessage.content.holder;
        return newMessage;
      });
      brMessages.store(messages, callback);
    }]
  }, function(err, results) {
    if(err) {
      callback(err);
    }
    callback(null, results.process);
  });
}
