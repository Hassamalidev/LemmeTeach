/**
 * The catalog (§9). Fifteen tools, and the access matrix from §8.1 is the
 * `agents` field on each one — there is no second copy of it to fall out of
 * sync.
 */
import { ToolBus, type Tool } from './index';
import { teachStep } from './teach-step';
import { askLearner, checkUnderstanding } from './ask-learner';
import { runCode } from './run-code';
import { compute } from './compute';
import { searchMaterials } from './search-materials';
import { wikiLookup } from './wiki-lookup';
import { recallLearner, updateLearner } from './learner';
import { saveNote, scheduleReview } from './notes';
import { planLesson, endLesson, finishExam, fixBoard } from './lifecycle';

export const ALL_TOOLS: Tool[] = [
  recallLearner,
  searchMaterials,
  wikiLookup,
  planLesson,
  teachStep,
  askLearner,
  checkUnderstanding,
  runCode,
  compute,
  updateLearner,
  saveNote,
  scheduleReview,
  endLesson,
  finishExam,
  fixBoard,
];

export function createToolBus(tools: Tool[] = ALL_TOOLS): ToolBus {
  return new ToolBus(tools);
}

export { ToolBus };
