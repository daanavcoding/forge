import { generateRepository } from '../generate-repo.mjs';

// Broad large-repo challenge: several hand-authored adapters behind 2,048
// generated entry points, without committing generated fixture files.
generateRepository(process.argv[2], { kind: 'long', moduleCount: 2_048 });
