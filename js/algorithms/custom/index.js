/**
 * Locally installed custom algorithm modules.
 *
 * To add your own algorithm: create a module next to this file following
 * greedyBestFirst.js (or docs/contributing-algorithms.md), import it here and add it to the
 * array. Modules are ordinary ES modules bundled with the app — no code is ever loaded from
 * user input or imported files.
 */
import greedyBestFirst from './greedyBestFirst.js';

export default [greedyBestFirst];
