import { createContext, useContext } from 'react';
import type { Block } from './types';
/** When set (report page), every assistant result offers "Add to report", which hands the block here. */
export const PinCtx = createContext<((b: Block) => void) | null>(null);
export const usePin = () => useContext(PinCtx);
