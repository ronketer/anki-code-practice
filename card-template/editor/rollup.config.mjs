import {browserResolver, failOnUnresolved} from "./build-tools.mjs"

export default [
  {input: "editor.mjs", output: {file: "../js/_codemirror6.js", format: "iife"},
   plugins: [browserResolver()], onwarn: failOnUnresolved},
  {input: "runtime.mjs", output: {file: "../js/_pro-runtime.js", format: "iife"},
   onwarn: failOnUnresolved}
]
