/**
 * The catalog (§9). Nine tools, and the access matrix from §8.1 is the
 * `agents` field on each one — there is no second copy of it to fall out of
 * sync.
 */
import { ToolBus, type Tool } from './index';
import { teachStep } from './teach-step';
import { askLearner } from './ask-learner';
import { runCode } from './run-code';
import { compute } from './compute';
import { wikiLookup } from './wiki-lookup';
import { saveNote } from './notes';
import { planLesson, endLesson, fixBoard } from './lifecycle';

export const ALL_TOOLS: Tool[] = [
  planLesson,
  askLearner,
  wikiLookup,
  teachStep,
  runCode,
  compute,
  saveNote,
  endLesson,
  fixBoard,
];

export function createToolBus(tools: Tool[] = ALL_TOOLS): ToolBus {
  return new ToolBus(tools);
}

export { ToolBus };
