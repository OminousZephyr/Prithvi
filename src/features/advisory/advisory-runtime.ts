import { localStore } from '@/data/storage/local-store';
import { AdvisoryRepository } from './advisory-repository';

export const advisoryRepository = new AdvisoryRepository(localStore);
