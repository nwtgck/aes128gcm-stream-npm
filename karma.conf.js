module.exports = function(config) {
    config.set({

        frameworks: ["jasmine", "karma-typescript"],

        files: [
            { pattern: "test/**/*.ts" }
        ],

        preprocessors: {
            "**/*.ts": ["karma-typescript"]
        },

        reporters: ["dots", "karma-typescript"],

        browsers: ["ChromeHeadless"],

        singleRun: true
    });
};
