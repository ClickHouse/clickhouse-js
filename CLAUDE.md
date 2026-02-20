# Recommendations for AI agents

## Ongoing refactoring

1. The code base is gradually migrating from passing groups of similar parameters as separate parameters to passing them as a single object. This is a common refactoring pattern that improves code readability and maintainability. When suggesting code changes, please consider this ongoing refactoring effort and prefer the new object-based parameter passing style.

2. The logging configuration is being updated to use eager log level evaluation instead of lazy evaluation. This means that the log level is determined at the time of client creation rather than being evaluated lazily during logging. When suggesting code changes related to logging, please ensure that the log level is being checked at the time of emission with a guard clause, rather than relying on the logger class tail-filtering logs based on the log level. This change is aimed at improving performance by avoiding unnecessary log message construction when the log level is not enabled.
