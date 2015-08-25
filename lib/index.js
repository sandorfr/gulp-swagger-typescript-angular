/**
 * Created by Cyprien on 8/18/2015.
 */
/// <reference path="../node_modules/typescript/bin/typescript.d.ts" />
/// <reference path="../typings/tsd.d.ts" />
var path = require('path');
var gutil = require('gulp-util');
var through = require('through2');
var handlebars = require('handlebars');
var async = require('async');
var fs = require('fs');
var _ = require('lodash');
var parser = require('swagger-parser');
var PLUGIN_NAME = 'gulp-swagger-typescript-amgular';
function main(options) {
    if (!options || !options.outputPath) {
        throw new gutil.PluginError(PLUGIN_NAME, 'A file name is required');
    }
    var clientName = options.clientName;
    if (!clientName) {
        clientName = 'ApiClient';
    }
    if (!options.partials) {
        options.partials = [];
    }
    return through.obj(function (file, enc, cb) {
        var trough2Context = this;
        loadPartials(options.partials, function () {
            gutil.log(options.outputPath);
            if (file.isNull()) {
                return cb(null, file);
            }
            if (file.isBuffer()) {
                gutil.log("processing file " + file.path);
                parser.parse(file.history[0], {
                    dereference$Refs: false,
                    validateSchema: false,
                    strictValidation: false
                }, function parseSchema(error, swaggerObject) {
                    parser.parse(swaggerObject, function parseSchema(error, swaggerObject) {
                        if (error) {
                            cb(new gutil.PluginError(PLUGIN_NAME, error));
                            return;
                        }
                        gutil.log("generating definitions");
                        fs.readFile(path.join(__dirname, './templates/ts/Definition.hbs'), 'utf8', function (err, data) {
                            if (err) {
                                return console.log(err);
                            }
                            var definitionTemplate = handlebars.compile(data, { noEscape: true });
                            var fileReferences = [];
                            for (var definitionName in swaggerObject.definitions) {
                                var definition = swaggerObject.definitions[definitionName];
                                var className = definitionName.replace(/\//g, '');
                                if (className === 'Error') {
                                    className = 'ErrorDto';
                                }
                                var fileName = className + '.ts';
                                fileReferences.push(fileName);
                                gutil.log('Generating ' + gutil.colors.magenta(fileName) + '\n ' + JSON.stringify(definition));
                                var context = generateContextFromPropertyDefinition(definition);
                                context.className = className;
                                context.module = options.module;
                                var content = definitionTemplate(context);
                                var file = new gutil.File({
                                    cwd: "",
                                    base: "",
                                    path: fileName,
                                    contents: new Buffer(content, 'utf8')
                                });
                                trough2Context.push(file);
                            }
                            fs.readFile(path.join(__dirname, './templates/ts/Typing.hbs'), 'utf8', function (err, data) {
                                if (err) {
                                    return console.log(err);
                                }
                                var typingTemplate = handlebars.compile(data, { noEscape: true });
                                fileReferences.push(clientName + '.ts');
                                var typingFile = new gutil.File({
                                    cwd: "",
                                    base: "",
                                    path: 'api.d.ts',
                                    contents: new Buffer(typingTemplate(fileReferences), 'utf8')
                                });
                                trough2Context.push(typingFile);
                                fs.readFile(path.join(__dirname, './templates/ts/Methods.hbs'), 'utf8', function (err, data) {
                                    if (err) {
                                        return console.log(err);
                                    }
                                    var serviceClientTemplate = handlebars.compile(data, { noEscape: true });
                                    var serviceClientContext = {
                                        module: options.module,
                                        clientName: clientName,
                                        basePath: swaggerObject.basePath,
                                        host: swaggerObject.host,
                                        methods: generateMethodsContext(swaggerObject.paths),
                                        scheme: 'http'
                                    };
                                    var serviceClientFile = new gutil.File({
                                        cwd: "",
                                        base: "",
                                        path: clientName + '.ts',
                                        contents: new Buffer(serviceClientTemplate(serviceClientContext), 'utf8')
                                    });
                                    trough2Context.push(serviceClientFile);
                                    cb();
                                });
                            });
                        });
                    });
                });
            }
            if (file.isStream()) {
                throw new gutil.PluginError(PLUGIN_NAME, 'Streaming not supported');
            }
        });
    });
}
function generateContextFromPropertyDefinition(definition) {
    var properties = definition.properties;
    var ancestor = undefined;
    if (definition.allOf) {
        for (var i = 0; i < definition.allOf.length; i++) {
            var set = definition.allOf[i];
            if (set['$ref']) {
                ancestor = getClassNameFromRef(set['$ref']);
            }
            else {
                properties = set.properties;
            }
        }
    }
    var propertyContext = [];
    for (var propertyName in properties) {
        var property = properties[propertyName];
        propertyContext.push({
            name: propertyName,
            type: getTypeScriptType(property),
            description: property.description
        });
    }
    return {
        ancestorClass: ancestor,
        properties: propertyContext
    };
}
function getClassNameFromRef(ref) {
    var lastSlash = ref.lastIndexOf('/');
    var className = ref.substring(lastSlash).replace(/~1/g, '').replace(/\//g, '');
    if (className == 'Error') {
        return 'ErrorDto';
    }
    return className;
}
function getTypeScriptType(property) {
    var ref = property.$ref;
    if (!ref && property.schema) {
        ref = property.schema.$ref;
    }
    if (ref) {
        return { name: getClassNameFromRef(ref) };
    }
    else {
        var type = property.type;
        if (type === 'integer' || type === 'number') {
            return { name: 'number' };
        }
        else if (type == 'string') {
            return { name: 'string' };
        }
        else if (type == 'boolean') {
            return { name: 'boolean' };
        }
        else if (type === 'object') {
            if (property.properties) {
                var propertyNames = _.keys(property.properties);
                return {
                    properties: propertyNames.map(function (x) {
                        return {
                            name: x,
                            type: getTypeScriptType(property.properties[x])
                        };
                    })
                };
            }
            else {
                return { name: 'any' };
            }
        }
        else if (type === 'array') {
            return { name: getTypeScriptType(property.items).name + '[]' };
        }
        else {
            gutil.log(gutil.colors.yellow("Unknown Type : " + type));
            return { name: 'any' };
        }
    }
}
function generateMethodsContext(paths) {
    var methods = [];
    for (var path_1 in paths) {
        var verbs = paths[path_1];
        for (var verb in verbs) {
            var details = verbs[verb];
            var method = {
                description: details.description,
                verb: verb.toUpperCase(),
                verbCamlCase: firstLetterUpperCase(verb),
                path: path_1,
                sanitizedPath: pathToCamlCase(path_1),
                returnType: getMethodReturnType(details),
                args: generateMethodsArgsContext(details),
                security: details.security ? { key: 'security_' + _.keys(details.security[0])[0] } : null
            };
            methods.push(method);
        }
    }
    return methods;
}
function getMethodReturnType(details) {
    var returnTypes = _.keys(details.responses);
    for (var i = 0; i < returnTypes.length; i++) {
        if (returnTypes[i].indexOf('20') === 0) {
            var response = details.responses[returnTypes[i]];
            return response.schema ? getTypeScriptType(response.schema).name : 'any';
        }
    }
    return 'any';
}
function generateMethodsArgsContext(method) {
    if (method.parameters) {
        return method.parameters.map(function (x) {
            return {
                name: x.name,
                argName: argToCamlCase(x.name),
                in: x.in,
                isQuery: x.in === 'query',
                isHeader: x.in === 'header',
                isBody: x.in === 'body',
                isPath: x.in === 'path',
                type: getTypeScriptType(x),
                description: x.description,
                optional: !x.required
            };
        }).sort(function (a, b) {
            if (a.optional === b.optional) {
                return a.name > b.name ? 1 : -1;
            }
            else {
                return a.optional ? 1 : -1;
            }
        });
    }
    else {
        return [];
    }
}
function argToCamlCase(path) {
    var segments = path.split(/\/|-/g);
    return segments.map(function (x, index) {
        if (x[0] === '{') {
            return 'By' + firstLetterUpperCasePreserveCasing(x.substr(1, x.length - 2));
        }
        else {
            if (index === 0) {
                return firstLetterLowerCasePreserveCasing(x);
            }
            else {
                return firstLetterUpperCase(x);
            }
            return firstLetterUpperCasePreserveCasing(x);
        }
    }).join('');
}
function pathToCamlCase(path) {
    var segments = path.split(/\/|-/g);
    return segments.map(function (x) {
        if (x[0] === '{') {
            return 'By' + firstLetterUpperCasePreserveCasing(x.substr(1, x.length - 2));
        }
        else {
            return firstLetterUpperCasePreserveCasing(x);
        }
    }).join('');
}
function firstLetterUpperCase(str) {
    return str.substring(0, 1).toUpperCase() + str.substring(1).toLowerCase();
}
function firstLetterUpperCasePreserveCasing(str) {
    return str.substring(0, 1).toUpperCase() + str.substring(1);
}
function firstLetterLowerCasePreserveCasing(str) {
    return str.substring(0, 1).toLowerCase() + str.substring(1);
}
function loadPartials(partials, callback) {
    gutil.log('loading partials');
    async.eachSeries(partials, function (partial, cb) {
        fs.readFile(partial.path, 'utf8', function (err, content) {
            if (!err) {
                handlebars.registerPartial(partial.name, content);
                gutil.log(content);
            }
            else {
                gutil.log(err);
            }
            cb(err);
        });
    }, function (err) {
        if (err) {
            throw new gutil.PluginError(PLUGIN_NAME, err);
        }
        callback();
    });
}
module.exports = main;
