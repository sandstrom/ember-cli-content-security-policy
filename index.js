var chalk = require('chalk');

var buildPolicyString = require('./lib/utils')['buildPolicyString'];

var CSP_SELF        = "'self'";
var CSP_NONE        = "'none'";
var REPORT_PATH     = '/csp-report';

var CSP_HEADER              = 'Content-Security-Policy';
var CSP_HEADER_REPORT_ONLY  = 'Content-Security-Policy-Report-Only';

var CSP_REPORT_URI          = 'report-uri';
var CSP_FRAME_ANCESTORS     = 'frame-ancestors';
var CSP_SANDBOX             = 'sandbox';

var META_UNSUPPORTED_DIRECTIVES = [
  CSP_REPORT_URI,
  CSP_FRAME_ANCESTORS,
  CSP_SANDBOX,
];

var unsupportedDirectives = function(policyObject) {
  return META_UNSUPPORTED_DIRECTIVES.filter(function(name) {
    return policyObject && (name in policyObject);
  });
}

var appendSourceList = function(policyObject, name, sourceList) {
  var oldSourceList;
  var oldValue = policyObject[name];

  if (Array.isArray(oldValue)) {
    oldSourceList = oldValue;
  } else if (!oldValue) {
    oldSourceList = [];
  } else if (typeof oldValue === 'string') {
    oldSourceList = oldValue.split(' ');
  } else {
    throw new Error('Unknown source list value');
  }

  oldSourceList.push(sourceList);
  policyObject[name] = oldSourceList.join(' ');
}

module.exports = {
  name: 'ember-cli-content-security-policy',

  config: function(/* environment, appConfig */) {
    return {
      contentSecurityPolicyHeader: CSP_HEADER_REPORT_ONLY,
      contentSecurityPolicy: {
        'default-src':  [CSP_NONE],
        'script-src':   [CSP_SELF],
        'font-src':     [CSP_SELF],
        'connect-src':  [CSP_SELF],
        'img-src':      [CSP_SELF],
        'style-src':    [CSP_SELF],
        'media-src':    [CSP_SELF],
      }
    };
  },

  serverMiddleware: function(config) {
    var app = config.app;
    var options = config.options;
    var project = options.project;

    app.use(function(req, res, next) {
      var appConfig = project.config(options.environment);

      var header = appConfig.contentSecurityPolicyHeader;
      var policyObject = appConfig.contentSecurityPolicy;

      // can be moved to the ember-cli-live-reload addon if RFC-22 is implemented
      // https://github.com/ember-cli/rfcs/pull/22
      if (options.liveReload) {
        ['localhost', '0.0.0.0'].forEach(function(host) {
          var liveReloadHost = host + ':' + options.liveReloadPort;
          appendSourceList(policyObject, 'connect-src', 'ws://' + liveReloadHost);
          appendSourceList(policyObject, 'script-src', liveReloadHost);
        });
      }

      // only needed for headers, since report-uri cannot be specified in meta tag
      if (header.indexOf('Report-Only') !== -1 && !('report-uri' in policyObject)) {
        var ecHost = options.host || 'localhost';
        var ecProtocol = options.ssl ? 'https://' : 'http://';
        var ecOrigin = ecProtocol + ecHost + ':' + options.port;
        appendSourceList(policyObject, 'connect-src', ecOrigin);
        policyObject['report-uri'] = ecOrigin + REPORT_PATH;
      }

      var headerValue = buildPolicyString(policyObject);

      if (!header || !headerValue) {
        next();
        return;
      }

      // clear existing headers before setting ours
      res.removeHeader(CSP_HEADER);
      res.removeHeader(CSP_HEADER_REPORT_ONLY);
      res.setHeader(header, headerValue);

      // for Internet Explorer 11 and below (Edge support the standard header name)
      res.removeHeader('X-' + CSP_HEADER);
      res.removeHeader('X-' + CSP_HEADER_REPORT_ONLY);
      res.setHeader('X-' + header, headerValue);

      next();
    });

    var bodyParser = require('body-parser');
    app.use(REPORT_PATH, bodyParser.json({ type: 'application/csp-report' }));
    app.use(REPORT_PATH, bodyParser.json({ type: 'application/json' }));
    app.use(REPORT_PATH, function(req, res, next) {
      console.log(chalk.red('Content Security Policy violation:') + '\n\n' + JSON.stringify(req.body, null, 2));
      res.send({ status:'ok' });
    });
  },

  contentFor: function(type, appConfig) {
    if ((type === 'head' && appConfig.contentSecurityPolicyMeta)) {
      var policyObject = appConfig.contentSecurityPolicy;
      var liveReloadPort = process.env.EMBER_CLI_INJECT_LIVE_RELOAD_PORT;

      // can be moved to the ember-cli-live-reload addon if RFC-22 is implemented
      // https://github.com/ember-cli/rfcs/pull/22
      if (liveReloadPort) {
        ['localhost', '0.0.0.0'].forEach(function(host) {
          var liveReloadHost = host + ':' + liveReloadPort;
          appendSourceList(policyObject, 'connect-src', 'ws://' + liveReloadHost);
          appendSourceList(policyObject, 'script-src', liveReloadHost);
        });
      }

      var policyString = buildPolicyString(policyObject);

      unsupportedDirectives(policyObject).forEach(function(name) {
        var msg = 'CSP deliverd via meta does not support `' + name + '`, ' +
                  'per the W3C recommendation.';
        console.log(chalk.yellow(msg));
      });

      if (!policyString) {
        console.log(chalk.yellow('CSP via meta tag enabled but no policy exist.'));
      } else {
        return '<meta http-equiv="' + CSP_HEADER + '" content="' + policyString + '">';
      }
    }
  }
};
