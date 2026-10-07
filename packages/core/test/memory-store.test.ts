import { MemoryStore } from '../src/storage.ts';
import { recordStoreContract } from './contract.ts';

recordStoreContract('MemoryStore', async () => new MemoryStore());
