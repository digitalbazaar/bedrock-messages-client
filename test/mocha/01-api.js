/*
 * Copyright (c) 2015-2016 Digital Bazaar, Inc. All rights reserved.
 */
/* globals describe, before, after, it, should */
/* jshint node: true */

'use strict';

var async = require('async');
var bedrock = require('bedrock');
var brMessagesClient = require('bedrock-messages-client');
var brTest = require('bedrock-test');
var config = bedrock.config;
var database = require('bedrock-mongodb');
var helpers = require('./helpers');
var request = brTest.require('request');
var sinon = require('sinon');
var url = require('url');
var mockData = require('./mock.data');
var store = database.collections.messages;
var scheduler = require('bedrock-jobs');

describe('bedrock-messages-client API requests', function() {
  before('Prepare the database', function(done) {
    helpers.prepareDatabase(mockData, done);
  });
  after('Remove test data', function(done) {
    helpers.removeCollections(done);
  });
  describe('pollServer Function', function() {
    it('return an error if the endpoint URL is invalid', done => {
      var client = {
        id: '390878cb-7abc-40b5-b243-84d1ae74236c',
        endpoint: 'invalidUrl',
        publicKeyId: mockData.identities.rsa4096.keys.publicKey.id,
        strictSSL: false
      };
      var pollOptions = {
        client: client,
        job: helpers.createJob()
      };
      async.auto({
        createClient: function(callback) {
          // create message client
          var record = {
            id: database.hash(client.id),
            meta: {recentPollErrorCount: 0},
            client: client
          };
          database.collections.messageClient.insert(record,
            database.writeOptions, callback);
        },
        pollServer1: ['createClient', function(callback) {
          brMessagesClient._pollServer(pollOptions, function(err) {
            should.exist(err);
            err.name.should.equal('PollServerError');
            err.message.should.contain('The server could not be contacted');
            err.cause.toString()
              .should.equal('Error: Invalid URI "invalidUrl"');
            callback();
          });
        }]
      }, done);
    });
    it('returns an error if the publicKeyId is invalid', done => {
      var client = {
        id: '4c03fcaf-5695-4e97-93c8-105a2083a079',
        endpoint: 'https://www.937a0674-a372-4aaa-aa9b-bac3e35a7e6c.com',
        publicKeyId: 'invalidKeyId',
        strictSSL: false
      };
      var pollOptions = {
        client: client,
        job: helpers.createJob()
      };
      async.auto({
        createClient: function(callback) {
          // create message client
          var record = {
            id: database.hash(client.id),
            meta: {recentPollErrorCount: 0},
            client: client
          };
          database.collections.messageClient.insert(record,
            database.writeOptions, callback);
        },
        pollServer1: ['createClient', function(callback) {
          brMessagesClient._pollServer(pollOptions, function(err) {
            should.exist(err);
            err.name.should.equal('PollServerError');
            err.message.should.contain('The server could not be contacted');
            err.cause.name.should.equal('NotFound');
            err.cause.message.should.equal('PublicKey not found.');
            callback();
          });
        }]
      }, done);
    });
    describe('polls a nonexistent server', function() {
      it('should return an error', done => {
        var client = {
          id: 'f300cf22-e4cd-4024-b198-a609994c5119',
          endpoint: 'https://www.937a0674-a372-4aaa-aa9b-bac3e35a7e6c.com',
          publicKeyId: mockData.identities.rsa4096.keys.publicKey.id,
          strictSSL: false
        };
        var pollOptions = {
          client: client,
          job: helpers.createJob()
        };
        async.auto({
          createClient: function(callback) {
            // create message client
            var record = {
              id: database.hash(client.id),
              meta: {recentPollErrorCount: 0},
              client: client
            };
            database.collections.messageClient.insert(record,
              database.writeOptions, callback);
          },
          pollServer1: ['createClient', function(callback) {
            brMessagesClient._pollServer(pollOptions, function(err) {
              should.exist(err);
              err.name.should.equal('PollServerError');
              err.message.should.contain('The server could not be contacted');
              callback();
            });
          }]
        }, done);
      });
      it('Exceeds max recentPollErrorCount', function(done) {
        config['messages-client'].stopPollingAfterNotify = true;
        config['messages-client'].maxPollErrorsBeforeNotify = 3;
        var client = {
          id: 'a11c439a-620b-4ca7-bc6b-e8b47deb0152',
          endpoint: 'https://www.937a0674-a372-4aaa-aa9b-bac3e35a7e6c.com',
          publicKeyId: mockData.identities.rsa4096.keys.publicKey.id,
          strictSSL: false
        };
        var pollOptions = {
          client: client,
          job: helpers.createJob()
        };
        async.auto({
          createClient: function(callback) {
            // create message client
            var record = {
              id: database.hash(client.id),
              meta: {recentPollErrorCount: 0},
              client: client
            };
            database.collections.messageClient.insert(record,
              database.writeOptions, callback);
          },
          pollServer1: ['createClient', function(callback) {
            brMessagesClient._pollServer(pollOptions, function(err) {
              should.exist(err);
              callback();
            });
          }],
          verify1: ['pollServer1', function(callback) {
            database.collections.messageClient.findOne({
              id: database.hash(client.id)
            }, {}, function(err, record) {
              should.not.exist(err);
              should.exist(record);
              record.meta.recentPollErrorCount.should.equal(1);
              callback();
            });
          }],
          pollServer2: ['verify1', function(callback) {
            brMessagesClient._pollServer(pollOptions, function(err) {
              should.exist(err);
              callback();
            });
          }],
          verify2: ['pollServer2', function(callback) {
            database.collections.messageClient.findOne({
              id: database.hash(client.id)
            }, {}, function(err, record) {
              should.not.exist(err);
              should.exist(record);
              record.meta.recentPollErrorCount.should.equal(2);
              callback();
            });
          }],
          pollServer3: ['verify2', function(callback) {
            brMessagesClient._pollServer(pollOptions, function(err) {
              should.exist(err);
              callback();
            });
          }],
          verify3: ['pollServer3', function(callback) {
            database.collections.messageClient.findOne({
              id: database.hash(client.id)
            }, {}, function(err, record) {
              should.not.exist(err);
              // when maxPollErrorsBeforeNotify is reached, recentPollErrorCount
              // is set to 0 and the job is unscheduled
              record.meta.recentPollErrorCount.should.equal(0);
              callback();
            });
          }]
        }, done);
      });
    });

    // NOTE: the tests in the block are designed to be run in series
    describe('polls a single server for new messages', function() {
      var user = mockData.identities.rsa4096;
      // messages-client
      var messageEndpoint = url.format({
        protocol: 'https',
        hostname: 'alpha.example.com',
        pathname: 'messages',
        query: {
          recipient: mockData.recipientId,
          state: 'new'
        }
      });

      var pollOptions = {
        client: {
          id: 'message.test',
          label: 'Message Test',
          endpoint: messageEndpoint,
          interval: 1, // Interval to poll in minutes
          publicKeyId: mockData.identities.rsa4096.keys.publicKey.id,
          strictSSL: false
        },
        job: helpers.createJob()
      };

      before(function() {
        // mock server returns no messages: []
        var messageCollections = [];
        messageCollections[0] = [];
        messageCollections[1] = helpers.createMessages(user.identity.id, 5);
        messageCollections[2] = helpers.createMessages(user.identity.id, 21);
        sinon.stub(request, 'get');
        for(var i = 0; i < messageCollections.length; i++) {
          request.get.onCall(i)
            .yields(null, {statusCode: 200}, messageCollections[i]);
        }
      });
      after(function() {
        request.get.restore();
      });

      it('polls a server and receives no messages', function(done) {
        async.auto({
          poll: function(callback) {
            brMessagesClient._pollServer(pollOptions, callback);
          },
          query: ['poll', function(callback) {
            store.find({}).toArray(callback);
          }],
          test: ['query', function(callback, results) {
            should.exist(results.query);
            results.query.should.be.an('array');
            // the database should have no messages.
            results.query.should.have.length(0);
            callback();
          }]
        }, done);
      });
      it('polls a server and receives five messages', function(done) {
        async.auto({
          poll: function(callback) {
            brMessagesClient._pollServer(pollOptions, callback);
          },
          query: ['poll', function(callback, results) {
            var query = {'value.meta.events.batch': results.poll.batch};
            store.find(query).toArray(callback);
          }],
          test: ['query', function(callback, results) {
            should.exist(results.query);
            results.query.should.be.an('array');
            results.query.should.have.length(5);
            callback();
          }]
        }, done);
      });
      it('polls a server and receives twenty-one messages', function(done) {
        async.auto({
          poll: function(callback) {
            brMessagesClient._pollServer(pollOptions, callback);
          },
          query: ['poll', function(callback, results) {
            var query = {'value.meta.events.batch': results.poll.batch};
            store.find(query).toArray(callback);
          }],
          test: ['query', function(callback, results) {
            should.exist(results.query);
            results.query.should.be.an('array');
            results.query.should.have.length(21);
            callback();
          }]
        }, done);
      });
    }); // end poll a single server

    describe('New message emitter', function() {
      var user = mockData.identities.rsa4096;
      // messages-client
      var messageEndpoint = url.format({
        protocol: 'https',
        hostname: 'alpha.example.com',
        pathname: 'messages',
        query: {
          recipient: mockData.recipientId,
          state: 'new'
        }
      });
      var pollOptions = {
        client: {
          id: 'message.test',
          label: 'Message Test',
          endpoint: messageEndpoint,
          interval: 1, // Interval to poll in minutes
          publicKeyId: mockData.identities.rsa4096.keys.publicKey.id,
          strictSSL: false
        },
        job: helpers.createJob()
      };
      before(function() {
        // mock server returns no messages: []
        var messageCollections = [];
        // messageCollections[0] = [];
        messageCollections[0] =
          helpers.createMessages(user.identity.id, 5, 'TypeAlpha');
        messageCollections[1] =
          helpers.createMessages(user.identity.id, 8, 'TypeBeta');
        messageCollections[2] =
          helpers.createMessages(user.identity.id, 3, 'TypeAlpha')
          .concat(helpers.createMessages(user.identity.id, 2, 'TypeBeta'));
        sinon.stub(request, 'get');
        messageCollections.forEach((collection, index) => {
          request.get.onCall(index)
            .yields(null, {statusCode: 200}, collection);
        });
        bedrock.events.on(
          'bedrock-messages-client.message.TypeAlpha', (message, callback) => {
            message.testProperty = '944b73cd-ff7a-4094-ae63-ebaee21cade2';
            callback();
          });
        bedrock.events.on(
          'bedrock-messages-client.message.TypeBeta', (message, callback) => {
            message.testProperty = '78d43857-3e0c-4cbf-8597-18a87c3a0df7';
            callback();
          });
      });
      after(function() {
        request.get.restore();
      });
      it('polls a server and receives five TypeAlpha messages', function(done) {
        async.auto({
          poll: function(callback) {
            brMessagesClient._pollServer(pollOptions, callback);
          },
          query: ['poll', function(callback, results) {
            var query = {'value.meta.events.batch': results.poll.batch};
            store.find(query).toArray(callback);
          }],
          test: ['query', function(callback, results) {
            should.exist(results.query);
            results.query.should.have.length(5);
            var filtered = results.query.filter(m => {
              return m.value.testProperty ===
                '944b73cd-ff7a-4094-ae63-ebaee21cade2';
            });
            filtered.should.have.length(5);
            callback();
          }]
        }, done);
      });
      it('polls a server and receives eight TypeBeta messages', done => {
        async.auto({
          poll: callback => {
            brMessagesClient._pollServer(pollOptions, callback);
          },
          query: ['poll', (callback, results) => {
            var query = {'value.meta.events.batch': results.poll.batch};
            store.find(query).toArray(callback);
          }],
          test: ['query', (callback, results) => {
            should.exist(results.query);
            results.query.should.have.length(8);
            var filtered = results.query.filter(m => {
              return m.value.testProperty ===
                '78d43857-3e0c-4cbf-8597-18a87c3a0df7';
            });
            filtered.should.have.length(8);
            callback();
          }]
        }, done);
      });
      it('receives TypeAlpha and TypeBeta message', done => {
        async.auto({
          poll: callback => {
            brMessagesClient._pollServer(pollOptions, callback);
          },
          query: ['poll', (callback, results) => {
            var query = {'value.meta.events.batch': results.poll.batch};
            store.find(query).toArray(callback);
          }],
          test: ['query', (callback, results) => {
            should.exist(results.query);
            results.query.should.have.length(5);
            var filteredAlpha = results.query.filter(m => {
              return m.value.testProperty ===
                '944b73cd-ff7a-4094-ae63-ebaee21cade2';
            });
            filteredAlpha.should.have.length(3);
            var filteredBeta = results.query.filter(m => {
              return m.value.testProperty ===
                '78d43857-3e0c-4cbf-8597-18a87c3a0df7';
            });
            filteredBeta.should.have.length(2);
            callback();
          }]
        }, done);
      });
    });
  });

  describe('start API', function() {
    before(function(done) {
      helpers.removeCollections(done);
    });

    after(function(done) {
      helpers.removeCollections(done);
    });

    it('one client', function(done) {
      var clientId = 'testClientId';
      var jobId = brMessagesClient._createJobId({id: clientId});

      async.waterfall([
        function(callback) {
          brMessagesClient.start({
            id: clientId,
            interval: 1
          }, callback);
        },
        function(callback) {
          scheduler.getJob(jobId, function(err, job) {
            should.not.exist(err);
            should.exist(job);
            job.schedule.should.equal('R/PT1M');
            callback();
          });
        },
        function(callback) {
          brMessagesClient.start({
            id: clientId,
            interval: 10
          }, callback);
        },
        function(callback) {
          scheduler.getJob(jobId, function(err, job) {
            should.not.exist(err);
            should.exist(job);
            job.schedule.should.equal('R/PT10M');
            callback();
          });
        },
        function(callback) {
          database.collections.job.find().toArray(function(err, results) {
            should.exist(results);
            results.should.be.an('array');
            callback();
          });
        }], done);
    });
  });
});
