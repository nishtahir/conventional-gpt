import * as core from "@actions/core";
import * as github from "@actions/github";

export async function run(): Promise<void> {
  console.log(JSON.stringify(github.context, null, 2));
  console.log("Success...");
}
