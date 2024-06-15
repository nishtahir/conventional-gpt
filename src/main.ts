import * as core from "@actions/core";
import * as github from "@actions/github";

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  console.log(github.context);
  console.log("Success...");
}
