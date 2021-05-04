import { Task, TaskWithoutReminder, TaskWithReminder } from '../../tasks/task.model';
import {
  BlockedBlock,
  BlockedBlockType,
  TimelineViewEntry,
  TimelineViewEntryType,
  TimelineWorkStartEndCfg
} from '../timeline.model';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { createBlockerBlocks } from './create-blocker-blocks';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { createTimelineViewEntriesForNormalTasks } from './create-timeline-view-entries-for-normal-tasks';
import * as moment from 'moment';

// const d = new Date();
// d.setTime(13);
// const FAKE_TIMELINE_EVENTS: TimelineCustomEvent[] = [{
//   title: 'Mittagspause',
//   duration: 60000 * 60,
//   start: d.getTime(),
//   icon: 'restaurant'
// }, {
//   title: 'Spazieren am Nachmittag',
//   duration: 60000 * 60 * .25,
//   start: Date.now() + 60000 * 60 * 2,
//   icon: 'nature',
// }];

export const mapToViewEntries = (
  tasks: Task[],
  currentId: string | null,
  workStartEndCfg?: TimelineWorkStartEndCfg,
  now: number = Date.now(),
): TimelineViewEntry[] => {
  let startTime = now;
  const params: any = {tasks, currentId, workStartEndCfg, now};
  console.log('mapToViewEntries', params, {asString: JSON.stringify(params)});

  if (workStartEndCfg) {
    const startTimeToday = getDateTimeFromClockString(workStartEndCfg.startTime, now);
    if (startTimeToday > now && !currentId) {
      startTime = startTimeToday;
    }
  }
  // TODO check for scheduled is current
  const initialTasks: Task[] = currentId
    ? resortTasksWithCurrentFirst(currentId, tasks)
    : tasks;

  const [scheduledTasks, nonScheduledTasks] = createSplitScheduledAndNotScheduled(initialTasks);
  const viewEntries = createTimelineViewEntriesForNormalTasks(startTime, nonScheduledTasks);

  const blockedBlocks = createBlockerBlocks(scheduledTasks, workStartEndCfg);

  insertBlockedBlocksViewEntries(viewEntries, blockedBlocks, now);

  viewEntries.sort((a, b) => a.time - b.time);

  // console.log('mapToViewEntriesE', viewEntries, {asString: JSON.stringify(viewEntries)});
  return viewEntries;
};

const createSplitScheduledAndNotScheduled = (tasks: Task[]): [TaskWithReminder[], TaskWithoutReminder[]] => {
  const scheduledTasks: TaskWithReminder[] = [];
  const nonScheduledTasks: TaskWithoutReminder[] = [];
  tasks.forEach((task, index, arr) => {
    if (task.reminderId && task.plannedAt) {
      scheduledTasks.push(task as TaskWithReminder);
    } else {
      nonScheduledTasks.push(task as TaskWithoutReminder);
    }
  });
  return [scheduledTasks, nonScheduledTasks];
};

const createViewEntriesForBlock = (blockedBlock: BlockedBlock): TimelineViewEntry[] => {
  const viewEntriesForBock: TimelineViewEntry[] = [];
  blockedBlock.entries.forEach(entry => {
    if (entry.type === BlockedBlockType.ScheduledTask) {
      // arr.push(...items);
      const scheduledTask = entry.data;
      viewEntriesForBock.push({
        id: scheduledTask.id,
        time: scheduledTask.plannedAt,
        type: TimelineViewEntryType.ScheduledTask,
        data: scheduledTask,
        isHideTime: false,
      });
    }
  });
  viewEntriesForBock.sort((a, b) => a.time - b.time);

  return viewEntriesForBock;
};

const insertBlockedBlocksViewEntries = (viewEntries: TimelineViewEntry[], blockedBlocks: BlockedBlock[], now: number) => {
  if (!blockedBlocks.length) {
    return;
  }
  const viewEntriesForUnScheduled = viewEntries.slice(0);

  console.log(viewEntries.map(viewEntry => ({
    viewEntry,
    timeD: moment(viewEntry.time).format('H:mm'),
    durationH: getTimeLeftForTask(viewEntry.data as any) / 60000 / 60,
  })));
  // console.log(blockedBlocks.map(block => ({
  //   block,
  //   startD: moment(block.start).format('H:mm'),
  //   endD: moment(block.end).format('H:mm'),
  // })));

  blockedBlocks.sort((a, b) => a.start - b.start);
  blockedBlocks.forEach((blockedBlock, i) => {
    const viewEntriesToAdd: TimelineViewEntry[] = createViewEntriesForBlock(blockedBlock);
    if (blockedBlock.start <= now) {
      const timeToGoForBlock = blockedBlock.end - now;
      viewEntriesForUnScheduled.forEach(viewEntry => {
        viewEntry.time = viewEntry.time + timeToGoForBlock;
      });

      // add entries
      viewEntries.splice(viewEntries.length, 0, ...viewEntriesToAdd);
      return;
    }

    const viewEntryForSplitTask: TimelineViewEntry | undefined = viewEntriesForUnScheduled.find(
      viewEntry =>
        viewEntry.time !== 0 &&
        viewEntry.time + getTimeLeftForTask(viewEntry.data as TaskWithoutReminder) >= blockedBlock.start &&
        viewEntry.time + getTimeLeftForTask(viewEntry.data as TaskWithoutReminder) <= blockedBlock.end
    );

    if (viewEntryForSplitTask) {
      const splitTask: TaskWithoutReminder = viewEntryForSplitTask.data as TaskWithoutReminder;
      let timePlannedForSplitTaskContinued = 0;
      const timeLeftForCompleteSplitTask = getTimeLeftForTask(splitTask);

      const timePlannedForSplitTaskBefore = blockedBlock.start - viewEntryForSplitTask.time;
      timePlannedForSplitTaskContinued = timeLeftForCompleteSplitTask - timePlannedForSplitTaskBefore;
      viewEntryForSplitTask.type = TimelineViewEntryType.SplitTask;

      viewEntriesToAdd.push({
        id: i + '_' + (splitTask as TaskWithoutReminder).id,
        time: blockedBlock.end,
        type: TimelineViewEntryType.SplitTaskContinued,
        data: {
          title: (splitTask as TaskWithoutReminder).title,
          timeToGo: timePlannedForSplitTaskContinued,
        },
        isHideTime: false,
      });
    }

    if (viewEntryForSplitTask) {
      const blockedBlockDuration = blockedBlock.end - blockedBlock.start;
      viewEntriesForUnScheduled.forEach(viewEntry => {
        if (viewEntry.time > blockedBlock.start && viewEntry !== viewEntryForSplitTask) {
          viewEntry.time = viewEntry.time + blockedBlockDuration;
        }
      });
    }

    // add entries
    viewEntries.splice(viewEntries.length, 0, ...viewEntriesToAdd);

  });
};

// const isTaskSplittableTaskType = (viewEntry: TimelineViewEntry): boolean => {
//   return viewEntry.type === TimelineViewEntryType.Task || viewEntry.type === TimelineViewEntryType.SplitTaskContinued;
// };

// const addVEForDayStartEnd = (
//   viewEntries: TimelineViewEntry[],
//   now: number,
//   currentId: null | string,
//   workStartEndCfg?: TimelineWorkStartEndCfg,
// ) => {
//   if (!workStartEndCfg) {
//     return;
//   }
//   const viewEntriesBefore: TimelineViewEntry[] = viewEntries.slice(0);
//   const startTimeToday = getDateTimeFromClockString(workStartEndCfg.startTime, now);
//   const startTimeTomorrow = getDateTimeFromClockString(workStartEndCfg.startTime, getTomorrow());
//   const endTimeToday = getDateTimeFromClockString(workStartEndCfg.endTime, now);
//
//   let firstDifference: number;
//   let daySwitchIndex: number = -1;
//
//   viewEntriesBefore.forEach((entry, index) => {
//     const timeEndForEntry = (entry.time && entry.type === TimelineViewEntryType.Task)
//       ? entry.time + getTimeLeftForTask(entry.data)
//       : entry.time;
//
//     if (entry.time && timeEndForEntry && timeEndForEntry >= endTimeToday) {
//       if (entry.time >= endTimeToday) {
//         if (!firstDifference) {
//           firstDifference = startTimeTomorrow - entry.time;
//           daySwitchIndex = index;
//         }
//         entry.time = entry.time + firstDifference;
//       } else {
//         // // split task
//         const timeToGoAfterWorkEnd = (timeEndForEntry - endTimeToday);
//         const timeDoneBeforeWorkEnd = getTimeLeftForTask(entry.data as Task) - timeToGoAfterWorkEnd;
//
//         if (!firstDifference) {
//           firstDifference = startTimeTomorrow - entry.time - timeDoneBeforeWorkEnd;
//           daySwitchIndex = index + 1;
//         }
//         entry.type = TimelineViewEntryType.SplitTask;
//         const splitInsertIndex = daySwitchIndex;
//
//         const splitTask = entry.data;
//
//         viewEntries.splice(splitInsertIndex, 0, {
//           id: (splitTask as Task).id + '__' + splitInsertIndex,
//           time: startTimeTomorrow,
//           type: TimelineViewEntryType.SplitTaskContinued,
//           data: {
//             title: (splitTask as Task).title,
//             timeToGo: timeToGoAfterWorkEnd,
//           },
//           isHideTime: false,
//         });
//       }
//     }
//   });
//
//   if (daySwitchIndex > -1) {
//     viewEntries.splice(daySwitchIndex, 0, {
//       id: 'START_TOMORROW',
//       time: startTimeTomorrow,
//       type: TimelineViewEntryType.WorkdayStart,
//       data: workStartEndCfg,
//       isHideTime: true,
//     });
//     viewEntries.splice(daySwitchIndex, 0, {
//       id: 'END_TODAY',
//       time: endTimeToday,
//       type: TimelineViewEntryType.WorkdayEnd,
//       data: workStartEndCfg,
//       isHideTime: true,
//     });
//   }
//   if (startTimeToday > now && !currentId) {
//     viewEntries.unshift({
//       id: 'START_TODAY',
//       time: startTimeToday,
//       type: TimelineViewEntryType.WorkdayStart,
//       data: workStartEndCfg,
//       isHideTime: true,
//     });
//   }
// };

const resortTasksWithCurrentFirst = (currentId: string, tasks: Task[]): Task[] => {
  let newTasks = tasks;
  const currentTask = tasks.find(t => t.id === currentId);
  if (currentTask) {
    newTasks = [currentTask, ...tasks.filter(t => t.id !== currentId)] as Task[];
  }
  return newTasks;
};

