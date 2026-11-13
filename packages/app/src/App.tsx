import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';
import { signInModule } from './modules/signIn';
import { orchestratorPlugin } from './modules/orchestrator';

export default createApp({
  features: [catalogPlugin, orchestratorPlugin, navModule, homeModule, signInModule],
});
