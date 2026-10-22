import { sampleProject } from '../../src/data/sampleProject';
import type { Feeder, Project } from '../../src/types';

/** A realistic wide DB used to exercise Office exports above the 500-circuit mark. */
export function projectWithCircuits(count = 510): Project {
  const boardId = 'DB-GF1';
  const template = sampleProject.feeders.find((f) => f.boardId === boardId && f.phase && f.way)!;
  const phases = ['R', 'Y', 'B'] as const;
  const circuits: Feeder[] = Array.from({ length: count }, (_, i) => ({
    ...template,
    id: `LARGE-${String(i + 1).padStart(4, '0')}`,
    name: `Large project circuit ${i + 1}`,
    room: `Area ${i + 1}`,
    points: { ltg: 1 },
    loadItems: undefined,
    loadKw: 0.1,
    phase: phases[i % phases.length],
    way: Math.floor(i / phases.length) + 1
  }));
  return {
    ...sampleProject,
    name: `Large export fixture (${count} circuits)`,
    boards: sampleProject.boards.map((b) => b.id === boardId ? { ...b, spareWays: [] } : b),
    feeders: [...sampleProject.feeders.filter((f) => f.boardId !== boardId), ...circuits]
  };
}
