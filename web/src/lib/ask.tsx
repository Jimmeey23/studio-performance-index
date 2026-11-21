import { createContext, useContext } from 'react';
/** Lets blocks (clarify buttons, follow-up chips, drill links) send a question to the active chat. */
export const AskCtx = createContext<((q: string) => void) | null>(null);
export const useAsk = () => useContext(AskCtx);
