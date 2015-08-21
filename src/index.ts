/**
 * Created by Cyprien on 8/18/2015.
 */

/// <reference path="../node_modules/typescript/bin/typescript.d.ts" />
/// <reference path="../typings/tsd.d.ts" />

import path = require('path');
import gutil = require('gulp-util');
import yargs = require('yargs');
import through = require('through2');
import handlebars = require('handlebars');
import fs = require('fs');
import _ = require('lodash');

let parser = require('swagger-parser');

let PLUGIN_NAME = 'gulp-swagger-typescript-amgular';

function main(options: any) {

    if (!options || !options.outputPath) {
        throw new gutil.PluginError(PLUGIN_NAME, 'A file name is required');
    }


    let clientName: string = options.clientName
    if (!clientName) {
        clientName = <any>'ApiClient'
    }
    ;

    gutil.log(options.outputPath);

    return through.obj(function (file: any, enc: any, cb: Function) {
        let trough2Context = this;
        if (file.isNull()) {
            // return empty file
            return cb(null, file);
        }

        if (file.isBuffer()) {

            gutil.log("processing file " + file.path);

            parser.parse(file.history[0], {
                dereference$Refs: false,
                validateSchema: false,
                strictValidation: false
            }, function parseSchema(error: any, swaggerObject: any) {


                parser.parse(swaggerObject, function parseSchema(error: any, swaggerObject: any) {
                    if (error) {
                        cb(new gutil.PluginError(PLUGIN_NAME, error));
                        return;
                    }

                    gutil.log("generating definitions");

                    fs.readFile(path.join(__dirname, './templates/ts/Definition.hbs'), 'utf8', function (err, data) {
                        if (err) {
                            return console.log(err);
                        }
                        var definitionTemplate: Function = handlebars.compile(data, {noEscape: true});

                        let fileReferences: string[] = [];

                        for (var definitionName in swaggerObject.definitions) {

                            var definition = swaggerObject.definitions[definitionName];

                            var className = (<string>definitionName).replace(/\//g, '');
                            var fileName = className + '.ts';
                            fileReferences.push(fileName);

                            gutil.log('Generating ' + gutil.colors.magenta(fileName) + '\n ' + JSON.stringify(definition));

                            var context = generateContextFromPropertyDefinition(definition);
                            context.className = className;
                            context.module = options.module;

                            let content = definitionTemplate(context);

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

                            var typingTemplate: Function = handlebars.compile(data, {noEscape: true});

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

                                var serviceClientTemplate: Function = handlebars.compile(data, {noEscape: true});

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


function generateContextFromPropertyDefinition(definition: any): any {
    let properties = definition.properties;
    let ancestor: string = undefined;
    if (definition.allOf) {

        for (let i = 0; i < definition.allOf.length; i++) {
            var set = definition.allOf[i];
            if (set['$ref']) {
                ancestor = getClassNameFromRef(set['$ref'])
            } else {
                properties = set.properties;
            }
        }
    }

    let propertyContext: any[] = [];

    for (let propertyName in properties) {
        let property = properties[propertyName];
        propertyContext.push({
            name: propertyName,
            type: getTypeScriptType(property),
            description: property.description
        });
    }

    return {
        ancestorClass: ancestor,
        properties: propertyContext
    }
}

function getClassNameFromRef(ref: string): string {
    var lastSlash = ref.lastIndexOf('/');
    return ref.substring(lastSlash/*, ref.length - lastSlash - 1*/).replace(/~1/g, '').replace(/\//g, '');
}

function getTypeScriptType(property: any): string {
    let ref = property.$ref;
    if (!ref && property.schema){
        ref = property.schema.$ref;
    }
    if (ref) {
        return getClassNameFromRef(ref);
    } else {
        let type = property.type;
        if (type === 'integer' || type === 'number') {
            return 'number';
        } else if (type == 'string') {
            return 'string'
        } else if (type == 'boolean') {
            return 'boolean'
        } else if (type === 'object') {
            return 'any';
        } else if (type === 'array') {
            return getTypeScriptType(property.items) + '[]';
        }
        else {
            gutil.log(gutil.colors.yellow("Unknown Type : " + type));
            return 'any';
        }
    }
}

function generateMethodsContext(paths: any): any[] {
    let methods: any[] = [];

    for (let path in paths) {
        var verbs = paths[path];
        for (let verb in verbs) {
            var details = verbs[verb];
            var method = {
                description: details.description,
                verb: (<string>verb).toUpperCase(),
                verbCamlCase: firstLetterUpperCase(verb),
                path: path,
                sanitizedPath: pathToCamlCase(path),
                returnType: 'any',
                args: generateMethodsArgsContext(details)
            };
            methods.push(method);
        }
    }

    return methods;
}


function generateMethodsArgsContext(method: any): any[] {
    if (method.parameters) {
        return (<any[]>method.parameters).map((x: any) => {
            return {
                name: x.name,
                argName: argToCamlCase(x.name),
                in: x.in,
                isQuery : x.in === 'query',
                isHeader : x.in === 'header',
                isBody : x.in === 'body',
                isPath : x.in === 'path',
                type: getTypeScriptType(x),
                description: x.description,
                optional: !x.required
            };
        });
    } else {
        return [];
    }
}

function argToCamlCase(path: string): string {
    let segments = path.split(/\/|-/g);
    return segments.map((x: string, index: number)=> {
        if (x[0] === '{') {
            return 'By' + firstLetterUpperCasePreserveCasing(x.substr(1, x.length - 2));
        } else {
            if (index === 0) {
                return firstLetterLowerCasePreserveCasing(x)
            } else {
                return firstLetterUpperCase(x);
            }
            return firstLetterUpperCasePreserveCasing(x);
        }
    }).join('');
}

function pathToCamlCase(path: string): string {
    let segments = path.split(/\/|-/g);
    return segments.map((x: string)=> {
        if (x[0] === '{') {
            return 'By' + firstLetterUpperCasePreserveCasing(x.substr(1, x.length - 2));
        } else {
            return firstLetterUpperCasePreserveCasing(x)
        }
    }).join('');
}

function firstLetterUpperCase(str: string): string {
    return (<string>str).substring(0, 1).toUpperCase() + (<string>str).substring(1).toLowerCase();
}

function firstLetterUpperCasePreserveCasing(str: string): string {
    return (<string>str).substring(0, 1).toUpperCase() + (<string>str).substring(1);
}

function firstLetterLowerCasePreserveCasing(str: string): string {
    return (<string>str).substring(0, 1).toLowerCase() + (<string>str).substring(1);
}


export = main;
