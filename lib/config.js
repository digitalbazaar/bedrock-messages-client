/*
 * Copyright (c) 2016 Digital Bazaar, Inc. All rights reserved.
 */

var config = require('bedrock').config;
var path = require('path');

config['messages-client'] = config['messages-client'] || {};
config['messages-client'].clients = config['messages-client'].clients || [];
config['messages-client'].maxPollErrorsBeforeNotify =
  ('maxPollErrorsBeforeNotify' in config['messages-client'] ?
  config['messages-client']['maxPollErrorsBeforeNotify'] : 3);
config['messages-client'].stopPollingAfterNotify = true;

var permissions = config.permission.permissions;
permissions.MESSAGE_CLIENT_ADMIN = {
  id: 'MESSAGE_CLIENT_ADMIN',
  label: 'Message Client Administration',
  comment: 'Required to administer Message Clients.'
};
