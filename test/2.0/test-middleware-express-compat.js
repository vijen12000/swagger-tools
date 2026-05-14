/* global describe, it */

/*
 * Express compatibility test suite.
 *
 * Mounts the same swagger-tools middleware chain on an express() app and
 * verifies that every middleware and the req.swagger shape work identically
 * to the connect() tests.  No client code changes should be required when
 * switching from Connect to Express.
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.RUNNING_SWAGGER_TOOLS_TESTS = 'true';

var _ = require('lodash');
var assert = require('assert');
var path = require('path');
var request = require('supertest');
var helpers = require('../helpers');

// Base petstore document – we clone it per-test to avoid cross-test pollution.
var petStoreBase = _.cloneDeep(require('../../samples/2.0/petstore.json'));

// Add controller annotations so that handlerCacheFromDir can resolve handlers.
// (mirrors what test/2.0/test-middleware-swagger-router.js does)
petStoreBase.paths['/pets']['x-swagger-router-controller'] = 'Pets';
petStoreBase.paths['/pets/{id}'].get['x-swagger-router-controller'] = 'Pets';
petStoreBase.paths['/pets/{id}'].delete['x-swagger-router-controller'] = 'Pets';

var optionsWithControllersDir = {
  controllers: path.join(__dirname, '..', 'controllers')
};

// ---------------------------------------------------------------------------
// Helper: identical to helpers.createServer but uses express()
// ---------------------------------------------------------------------------
function createExpressServer (initArgs, options, callback) {
  return helpers.createExpressServer(initArgs, options, callback);
}

// ---------------------------------------------------------------------------
// swaggerMetadata – route matching and req.swagger population
// ---------------------------------------------------------------------------
describe('Express compatibility – swaggerMetadata', function () {
  it('should not attach req.swagger for unmatched routes', function (done) {
    createExpressServer([_.cloneDeep(petStoreBase)], {
      handler: function (req, res, next) {
        if (req.swagger) {
          return next(new Error('req.swagger should not be set'));
        }
        res.end('OK');
      }
    }, function (app) {
      request(app)
        .get('/no-such-route')
        .expect(200)
        .end(helpers.expectContent('OK', done));
    });
  });

  it('should attach req.swagger for a matched route', function (done) {
    createExpressServer([_.cloneDeep(petStoreBase)], {
      swaggerRouterOptions: {
        controllers: {
          Pets_getAllPets: function (req, res) {
            assert.ok(req.swagger, 'req.swagger must be set');
            assert.ok(req.swagger.operation, 'req.swagger.operation must be set');
            assert.strictEqual(req.swagger.swaggerVersion, '2.0');
            res.end('OK');
          }
        }
      }
    }, function (app) {
      request(app)
        .get('/api/pets')
        .expect(200)
        .end(helpers.expectContent('OK', done));
    });
  });

  it('should populate req.swagger.params for path parameters', function (done) {
    createExpressServer([_.cloneDeep(petStoreBase)], {
      swaggerRouterOptions: {
        controllers: {
          Pets_getPetById: function (req, res) {
            assert.ok(req.swagger.params, 'req.swagger.params must be set');
            assert.ok(req.swagger.params.id, 'path param id must exist');
            res.end('OK');
          }
        }
      }
    }, function (app) {
      request(app)
        .get('/api/pets/1')
        .expect(200)
        .end(helpers.expectContent('OK', done));
    });
  });
});

// ---------------------------------------------------------------------------
// swaggerValidator – request validation
// ---------------------------------------------------------------------------
describe('Express compatibility – swaggerValidator', function () {
  it('should pass a valid request', function (done) {
    createExpressServer([_.cloneDeep(petStoreBase)], {
      swaggerRouterOptions: optionsWithControllersDir
    }, function (app) {
      request(app)
        .get('/api/pets')
        .expect(200)
        .end(done);
    });
  });

  it('should reject a request with an invalid query parameter type', function (done) {
    var doc = _.cloneDeep(petStoreBase);
    
    // Add a limit query parameter with integer type (for validation testing)
    doc.paths['/pets'].get.parameters = doc.paths['/pets'].get.parameters || [];
    doc.paths['/pets'].get.parameters.push({
      name: 'limit',
      in: 'query',
      type: 'integer',
      required: false
    });

    createExpressServer([doc], {
      swaggerRouterOptions: optionsWithControllersDir
    }, function (app) {
      request(app)
        .get('/api/pets')
        .query({ limit: 'not-a-number' })
        .expect(400)
        .end(done);
    });
  });
});

// ---------------------------------------------------------------------------
// swaggerRouter – controller directory loading
// ---------------------------------------------------------------------------
describe('Express compatibility – swaggerRouter (controller directory)', function () {
  it('should resolve a handler from a controller directory', function (done) {
    createExpressServer([_.cloneDeep(petStoreBase)], {
      swaggerRouterOptions: optionsWithControllersDir
    }, function (app) {
      request(app)
        .get('/api/pets')
        .expect(200)
        .end(done);
    });
  });
});

// ---------------------------------------------------------------------------
// swaggerRouter – controller map (inline object)
// ---------------------------------------------------------------------------
describe('Express compatibility – swaggerRouter (controller map)', function () {
  it('should resolve a handler from an inline controller map', function (done) {
    var handlerCalled = false;

    createExpressServer([_.cloneDeep(petStoreBase)], {
      swaggerRouterOptions: {
        controllers: {
          Pets_getAllPets: function (req, res) {
            handlerCalled = true;
            res.end('pets-from-map');
          }
        }
      }
    }, function (app) {
      request(app)
        .get('/api/pets')
        .expect(200)
        .end(function (err) {
          assert.ok(handlerCalled, 'controller map handler must have been called');
          done(err);
        });
    });
  });
});

// ---------------------------------------------------------------------------
// swaggerRouter – stub/missing handler
// ---------------------------------------------------------------------------
describe('Express compatibility – swaggerRouter (stub / missing handler)', function () {
  it('should return 500 when no handler is found and useStubs is false', function (done) {
    // The router sets res.statusCode = 500 for unresolvable handlers
    createExpressServer([_.cloneDeep(petStoreBase)], {
      swaggerRouterOptions: { controllers: {} }
    }, function (app) {
      request(app)
        .get('/api/pets')
        .expect(500)
        .end(done);
    });
  });

  it('should return 200 when useStubs is true', function (done) {
    createExpressServer([_.cloneDeep(petStoreBase)], {
      swaggerRouterOptions: { controllers: {}, useStubs: true }
    }, function (app) {
      request(app)
        .get('/api/pets')
        .expect(200)
        .end(done);
    });
  });
});

// ---------------------------------------------------------------------------
// swaggerSecurity
// ---------------------------------------------------------------------------
describe('Express compatibility – swaggerSecurity', function () {
  it('should call security handler and allow the request', function (done) {
    var doc = _.cloneDeep(petStoreBase);

    // Add a security requirement on the /pets GET path using the existing oauth2 definition
    doc.paths['/pets'].get.security = [{ oauth2: ['read'] }];

    var handlerCalled = false;

    createExpressServer([doc], {
      swaggerRouterOptions: optionsWithControllersDir,
      swaggerSecurityOptions: {
        oauth2: function (req, securityDef, scopes, cb) {
          handlerCalled = true;
          cb();
        }
      }
    }, function (app) {
      request(app)
        .get('/api/pets')
        .expect(200)
        .end(function (err) {
          assert.ok(handlerCalled, 'security handler must have been called');
          done(err);
        });
    });
  });
});

// ---------------------------------------------------------------------------
// swaggerUi – serving docs
// ---------------------------------------------------------------------------
describe('Express compatibility – swaggerUi', function () {
  it('should serve the Swagger JSON document at /api-docs', function (done) {
    var doc = _.cloneDeep(petStoreBase);

    createExpressServer([doc], {}, function (app) {
      request(app)
        .get('/api-docs')
        .expect(200)
        .end(function (err, res) {
          if (err) { return done(err); }
          assert.deepEqual(JSON.parse(res.text), doc);
          done();
        });
    });
  });

  it('should serve the Swagger UI HTML at /docs/', function (done) {
    createExpressServer([_.cloneDeep(petStoreBase)], {}, function (app) {
      request(app)
        .get('/docs/')
        .expect(200)
        .end(function (err, res) {
          if (err) { return done(err); }
          assert.ok(res.text.indexOf('swagger') !== -1 || res.text.indexOf('Swagger') !== -1,
                    'response should contain swagger UI markup');
          done();
        });
    });
  });
});

