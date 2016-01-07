/*
 * Bedrock messages-client module.
 *
 * Copyright (c) 2015 Digital Bazaar, Inc. All rights reserved.
 */
 /* jshint node: true */

'use strict';

var async = require('async');
var bedrock = require('bedrock');
var config = bedrock.config;
var scheduler = require('bedrock-jobs');

require('./config');

var POLL_MESSAGES_SERVER = 'messages-client.jobs.PollMessagesServer';

var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

bedrock.events.on('bedrock.init', function() {
  if(config['messages-client'].enableScheduledJobs) {
    scheduler.define(POLL_MESSAGES_SERVER,
      // FIXME: lockduration not specified
      // {lockDuration: 30000},
      function(job, callback) {
        pollMessageServer(job, callback);
      }
    );
  }
});

// exposed for testing
api._pollMessageServer = function(job, callback) {
  pollMessageServer(job, callback);
};

function pollMessageServer(job, callback) {
  console.log('JOB', job);
}
