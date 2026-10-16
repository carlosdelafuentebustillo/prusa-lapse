### Rule: Enforce Version Bumping on Significant Changes
When making significant changes, architectural updates, or major bug fixes to the codebase in the Prusa-lapse project, you MUST always update the version number to reflect the changes before concluding the task.
- For firmware changes, increment the `#define FIRMWARE_VERSION` string at the top of `firmware/src/main.cpp`.
- For web application changes, increment the `"version"` field in `webapp/package.json`.
