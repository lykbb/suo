import { useMemo } from 'react';
import { presentMessageError } from './messageError.mjs';
import './MessageError.css';

export default function MessageError({ error }: { error: string }) {
  const message = useMemo(() => presentMessageError(error), [error]);
  return <div className="message-error-summary" role="alert"><strong>{message.title}</strong><p>{message.reason}</p></div>;
}
