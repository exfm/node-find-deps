"use strict";

var esprima = require('esprima'),
    request = require('request'),
    when = require('when'),
    fs = require('fs');


var modules = [],
    requiredModules = {},
    builtins = ["assert", "buffer", "addons", "child_process",
        "cluster", "crypto", "debugger", "dns", "domain",
        "events", "fs", "globals", "http", "https",
        "modules", "net", "os", "path",
        "process", "punycode", "querystring", "readline",
        "repl", "stdio", "stream", "string_decoder",
        "timers", "tls", "tty", "dgram", "url", "util",
        "vm", "zlib"];


function walk(dir, done) {
    var results = [];
    fs.readdir(dir, function (err, list) {
        if (err) {
            return done(err);
        }
        var i = 0;
        (function next() {
            var file = list[i++];
            if (!file) {
                return done(null, results);
            }
            file = dir + '/' + file;
            fs.stat(file, function (err, stat) {
                if (stat && stat.isDirectory()){
                    if(file.indexOf('node_modules') > -1){
                        return next();
                    }
                    walk(file, function (err, res) {
                        results = results.concat(res);
                        next();
                    });
                } else {
                    if(file.slice(-3) === '.js'){
                        results.push(file);
                    }
                    next();
                }
            });
        }());
    });
}

function parseFile(filename){
    var d = when.defer(),
        tree;

    fs.readFile(filename, 'utf-8', function(err, data){
        tree = esprima.parse(data.toString());
        requiredModules[filename] = [];

        tree.body.forEach(function(node){
            if(node.type === "VariableDeclaration"){
                node.declarations.forEach(function(decl){
                    if(decl.init && decl.init.type === "CallExpression" &&
                        decl.init.callee.name === "require" &&
                        decl.init['arguments'][0].value.indexOf('/') === -1){
                        requiredModules[filename].push(decl.init['arguments'][0].value);
                    }
                });
            }
        });
        d.resolve(filename);
    });
    return d.promise;
}
module.exports = function(where){
    var d = when.defer();
    walk(where, function(err, results){
        when.all(results.map(parseFile), function(){
            Object.keys(requiredModules).forEach(function(filename){
                requiredModules[filename].forEach(function(mod){
                    if(modules.indexOf(mod) === -1){
                        modules.push({'name': mod});
                    }
                });
            });

            when.all(modules.map(function(mod, index){
                var d = when.defer();
                request.get('http://registry.npmjs.org/' + mod.name, function (error, response, body){
                    if (!error && response.statusCode === 200) {
                        modules[index].version = JSON.parse(body)['dist-tags'].latest;
                        d.resolve(modules[index]);
                    }
                    else{
                        d.resolve(null);
                    }
                });
                return d.promise;
            }), function(){
                var fin = {};
                modules.filter(function(mod){
                    return mod.hasOwnProperty('version') && builtins.indexOf(mod.name) === -1;
                }).forEach(function(mod){
                    fin[mod.name] = mod.version;
                });
                d.resolve(fin);
            });
        });
    });
    return d.promise;
};
