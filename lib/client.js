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

// configure for tests
bedrock.events.on('bedrock.test.configure', function() {
  require('./test.config');
});

var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

// FIXME: replace private key information with a signing service
// private key should be kept safe
api.MessageClient = function(options) {
  this.endpoint = options.endpoint;
  this.privateKeyPem = options.privateKeyPem;
  this.publicKeyId = options.publicKeyId;
  this.jobId = uuid();
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
      publicKeyId: self.publicKeyId
    };
    pollServer(options, function(err, results) {
      if(err) {
        return callback(err);
      }
      // FIXME:
      console.log('MESSAGE_CLIENT_RESULTS', results);
      callback(null);
    });
  });
};

// exposed for testing
api._pollServer = function(job, endpoint, identity, callback) {
  pollServer(job, endpoint, identity, callback);
};

function pollServer(options, callback) {
  console.log('MESSAGE_CLIENT_POLLING', options.endpoint);
  async.auto({
    poll: function(callback) {
      request.post({
        url: options.endpoint,
        httpSignature: {
          key: options.privateKeyPem,
          keyId: options.publicKeyId,
          headers: ['date', 'host', 'request-line']
        },
        json: true
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
      var messages = results.poll.map(function(message) {
        var newMessage = message;
        newMessage.recipient = newMessage.content.holder;
        return newMessage;
      });
      brMessages.store(messages, callback);
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    callback(null, results.process);
  });
}
