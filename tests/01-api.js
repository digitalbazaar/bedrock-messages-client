/*
 * Copyright (c) 2015 Digital Bazaar, Inc. All rights reserved.
 */
 /* globals describe, before, after, it, should, beforeEach, afterEach */
 /* jshint node: true */

'use strict';

var _ = require('lodash');
var async = require('async');
var bedrock = require('bedrock');
var brMessages = require('bedrock-messages');
var brMessagesClient = require('../lib/client');
var config = bedrock.config;
var database = require('bedrock-mongodb');
var helpers = require('./helpers');
var request = require('request');
var sinon = require('sinon');
var uuid = require('node-uuid').v4;
var mockData = require('./mock.data');
var store = database.collections.messages;
var scheduler = require('bedrock-jobs');

describe('bedrock-messages-client API requests', function() {
  describe('pollMessagesServer Function', function() {
    // NOTE: the tests in the block are designed to be run in series
    describe('polls a single server for new messages', function() {
      var postStub;
      var user = mockData.identities.rsa4096;
      var serverOptions = {
        server: mockData.messageServers.alpha,
        id: user.identity.id,
        endpoint: 'search'
      };

      before(function() {
        // mock server returns no messages: []
        var messageCollections = [];
        messageCollections[0] = [];
        messageCollections[1] = helpers.createMessages(user.identity.id, 5);
        messageCollections[2] = helpers.createMessages(user.identity.id, 21);
        postStub = sinon.stub(request, 'post');
        for(var i = 0; i < messageCollections.length; i++) {
          postStub.onCall(i)
            .yields(null, {statusCode: 200}, messageCollections[i]);
        }
      });
      after(function() {
        postStub.restore();
      });

      it('polls a server and receives no messages', function(done) {
        async.auto({
          poll: function(callback) {
            var options = {
              job: helpers.createJob(),
              endpoint: helpers.createUrl(serverOptions),
              privateKeyPem: user.keys.privateKey.privateKeyPem,
              publicKeyId: user.keys.publicKey.id
            };
            brMessagesClient._pollServer(options, callback);
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
            var options = {
              job: helpers.createJob(),
              endpoint: helpers.createUrl(serverOptions),
              privateKeyPem: user.keys.privateKey.privateKeyPem,
              publicKeyId: user.keys.publicKey.id
            };
            brMessagesClient._pollServer(options, callback);
          },
          query: ['poll', function(callback, results) {
            console.log('$$$$$$$$$', results.poll);
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
            var options = {
              job: helpers.createJob(),
              endpoint: helpers.createUrl(serverOptions),
              privateKeyPem: user.keys.privateKey.privateKeyPem,
              publicKeyId: user.keys.publicKey.id
            };
            brMessagesClient._pollServer(options, callback);
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
    });
  });

  describe.only('start API', function() {
    before(function(done) {
      helpers.removeCollections(done);
    });

    after(function(done) {
      helpers.removeCollections(done);
    });

    it('one client', function(done) {
      var endpoint = 'www.example.com';
      var jobId = brMessagesClient._createJobId(endpoint);

      async.waterfall([
        function(callback) {
          brMessagesClient.start(endpoint, 1, callback);
        },
        function(callback) {
          scheduler.getJob(jobId, function(err, job, meta) {
            should.not.exist(err);
            should.exist(job);
            job.schedule.should.equal('R/PT1M');
            callback();
          });
        },
        function(callback) {
          brMessagesClient.start(endpoint, 10, callback);
        },
        function(callback) {
          scheduler.getJob(jobId, function(err, job, meta) {
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
            results.should.be.have.length(1);
            callback();
          });
        }], function() {
          done();
        });
    });
  });
});
