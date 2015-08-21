/**
 * Created by Cyprien on 8/18/2015.
 */
/// <reference path="../node_modules/typescript/bin/typescript.d.ts" />
/// <reference path="../typings/tsd.d.ts" />
var path = require('path');
var gutil = require('gulp-util');
var through = require('through2');
var handlebars = require('handlebars');
var fs = require('fs');
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
    ;
    gutil.log(options.outputPath);
    return through.obj(function (file, enc, cb) {
        var trough2Context = this;
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
    return ref.substring(lastSlash).replace(/~1/g, '').replace(/\//g, '');
}
function getTypeScriptType(property) {
    var ref = property.$ref;
    if (!ref && property.schema) {
        ref = property.schema.$ref;
    }
    if (ref) {
        return getClassNameFromRef(ref);
    }
    else {
        var type = property.type;
        if (type === 'integer' || type === 'number') {
            return 'number';
        }
        else if (type == 'string') {
            return 'string';
        }
        else if (type == 'boolean') {
            return 'boolean';
        }
        else if (type === 'object') {
            return 'any';
        }
        else if (type === 'array') {
            return getTypeScriptType(property.items) + '[]';
        }
        else {
            gutil.log(gutil.colors.yellow("Unknown Type : " + type));
            return 'any';
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
                returnType: 'any',
                args: generateMethodsArgsContext(details)
            };
            methods.push(method);
        }
    }
    return methods;
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
module.exports = main;
