import { generateRepository } from '../generate-repo.mjs';

// ponytail: the large-repo claim needs generated scale, not a checked-in blob.
generateRepository(process.argv[2], { kind: 'large', moduleCount: 2_048 });
