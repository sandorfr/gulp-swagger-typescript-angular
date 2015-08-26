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
var async = require('async');
import fs = require('fs');
import _ = require('lodash');

let parser = require('swagger-parser');

let PLUGIN_NAME = 'gulp-swagger-typescript-amgular';

function main(options: any) {

    if (!options || !options.outputPath) {
        throw new gutil.PluginError(PLUGIN_NAME, 'A file name is required');
    }


    let clientName: string = options.clientName;
    if (!clientName) {
        clientName = <any>'ApiClient';
    }

    if (!options.partials) {
        options.partials = [];
    }

    return through.obj(function (file: any, enc: any, cb: Function) {
        let trough2Context = this;

        loadPartials(options.partials, () => {

            gutil.log(options.outputPath);

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
                                if (className === 'Error'){
                                    className = 'ErrorDto';
                                }
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
                                        hostInject: options.hostInject,
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
    var className = ref.substring(lastSlash/*, ref.length - lastSlash - 1*/).replace(/~1/g, '').replace(/\//g, '');

    if (className == 'Error'){
        return 'ErrorDto';
    }

    return className;
}


interface Type {
    name?:string;
    properties?: {
        name : string,
        type : Type}[];
}

function getTypeScriptType(property: any): Type {
    let ref = property.$ref;
    if (!ref && property.schema) {
        ref = property.schema.$ref;
    }
    if (ref) {
        return {name: getClassNameFromRef(ref)};
    } else {
        let type = property.type;
        if (type === 'integer' || type === 'number') {
            return {name: 'number'};
        } else if (type == 'string') {
            return {name: 'string'}
        } else if (type == 'boolean') {
            return {name: 'boolean'}
        } else if (type === 'object') {
            if (property.properties) {
                var propertyNames = _.keys(property.properties);
                return {
                    properties: propertyNames.map(x=> {return{
                        name: x,
                        type: getTypeScriptType(property.properties[x])
                    }})
                };
            } else {
                return {name: 'any'};
            }
        } else if (type === 'array') {
            return {name: getTypeScriptType(property.items).name + '[]'};
        }
        else {
            gutil.log(gutil.colors.yellow("Unknown Type : " + type));
            return {name: 'any'};
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
                returnType: getMethodReturnType(details),
                args: generateMethodsArgsContext(details),
                security: details.security ? {key: 'security_' + _.keys(details.security[0])[0]} : null
            };
            methods.push(method);
        }
    }

    return methods;
}

function getMethodReturnType(details: any): string {
    var returnTypes: string[] = _.keys(details.responses);

    for (var i = 0; i < returnTypes.length; i++) {
        if (returnTypes[i].indexOf('20') === 0) {
            var response = details.responses[returnTypes[i]];
            return response.schema ? getTypeScriptType(response.schema).name : 'any';
        }
    }

    return 'any';
}


function generateMethodsArgsContext(method: any): any[] {
    if (method.parameters) {
        return (<any[]>method.parameters).map((x: any) => {
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
        }).sort((a: any, b: any): number => {
            if (a.optional === b.optional) {
                return a.name > b.name ? 1 : -1;
            } else {
                return a.optional ? 1 : -1;
            }
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

function loadPartials(partials: any, callback: Function) {
    gutil.log('loading partials');

    async.eachSeries(
        // Pass items to iterate over
        partials,
        // Pass iterator function that is called for each item
        function (partial: any, cb: Function) {
            fs.readFile(partial.path, 'utf8', function (err: any, content: string) {
                if (!err) {
                    // Calling cb makes it go to the next item.
                    handlebars.registerPartial(partial.name, content);
                    gutil.log(content);
                } else {
                    gutil.log(err);
                }
                // Calling cb makes it go to the next item.
                cb(err);
            });
        },
        // Final callback after each item has been iterated over.
        function (err: any) {
            if (err) {
                throw new gutil.PluginError(PLUGIN_NAME, err);
            }
            callback();
        }
    );
}

export = main;
