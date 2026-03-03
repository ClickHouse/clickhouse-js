# Recommendations for AI agents

## When reviewing code changes

For every pull request review, make sure to provide an evaluation of the following aspects:

### Security implications

1. This repository is a client library for ClickHouse, which is a database management system. When reviewing code changes, it is important to consider the security implications of the changes. For example, if the code changes involve handling user input or interacting with external systems, it is important to ensure that the code is secure and does not introduce vulnerabilities such as SQL injection or cross-site scripting (XSS).

2. Additionally, when reviewing code changes, it is important to consider the potential impact on data privacy and compliance with relevant regulations such as GDPR or CCPA. For example, if the code changes involve handling personally identifiable information (PII), it is important to ensure that the code is designed to protect user privacy and comply with relevant regulations.

### API quality and stability

1. When reviewing code changes, it is important to consider the impact on the API quality and stability. For example, if the code changes involve modifying the library's public API surface (such as exported functions, classes, or types) or adding new public APIs, it is important to ensure that the changes are well-documented and do not break existing functionality for users of the library.

2. When introducing new features or making changes to the API make sure to update the CHANGELOG.md file with a concise description of the changes followed with an example usage if applicable.

3. Additionally, make sure that the official documentation is in sync with the changes. The MCP server for the documentation is running at `https://clickhouse.mcp.kapa.ai/`.

### Ongoing refactoring

Keep in mind the ongoing refactoring efforts in the codebase. If required, put more effort into bringing more relevant code and recent changes into the context.

1. The code base is gradually migrating from passing groups of similar parameters as separate parameters to passing them as a single object. This is a common refactoring pattern that improves code readability and maintainability. When suggesting code changes, please consider this ongoing refactoring effort and prefer the new object-based parameter passing style.

2. The logging configuration is being updated to use eager log level evaluation instead of lazy evaluation. This means that the log level is determined at the time of client creation rather than being evaluated lazily during logging. When suggesting code changes related to logging, please ensure that the log level is being checked at the time of emission with a guard clause, rather than relying on the logger class tail-filtering logs based on the log level. This change is aimed at improving performance by avoiding unnecessary log message construction when the log level is not enabled.
