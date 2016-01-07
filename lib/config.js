/*
 * Copyright (c) 2015 Digital Bazaar, Inc. All rights reserved.
 */

var config = require('bedrock').config;
var path = require('path');

config['messages-client'] = {};
config['messages-client'].enableScheduledJobs = true;

config.scheduler.jobs.push({
  id: 'messages-client.jobs.PollMessagesServer',
  type: 'messages-client.jobs.PollMessagesServer',
  // repeat forever, run every minute
  schedule: 'R/PT1M',
  // no special priority
  priority: 0,
  concurrency: 1
});
