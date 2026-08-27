import { LocalMindLogo } from '@affine/component/localmind-logo';
import { Navigate } from 'react-router-dom';

import { useServerConfig } from '../common';
import { Form } from './form';

export function Setup() {
  const config = useServerConfig();

  if (config.initialized) {
    return <Navigate to="/admin" />;
  }

  return (
    <div className="w-full lg:grid lg:grid-cols-2 h-dvh">
      <div className="flex items-center justify-center py-12 h-full">
        <Form />
      </div>
      <div className="hidden lg:block relative overflow-hidden ">
        <LocalMindLogo
          alt="LocalMind"
          className="absolute object-contain bottom-[12.5%] right-[12.5%] h-3/4 w-3/4"
        />
      </div>
    </div>
  );
}

export { Setup as Component };
