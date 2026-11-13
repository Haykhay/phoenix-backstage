import {
  PageBlueprint,
  createFrontendPlugin,
  createRouteRef,
} from '@backstage/frontend-plugin-api';
import BuildIcon from '@material-ui/icons/Build';

const rootRouteRef = createRouteRef();

const page = PageBlueprint.make({
  params: {
    path: '/orchestrator',
    routeRef: rootRouteRef,
    title: 'Orchestrator',
    icon: <BuildIcon />,
    loader: () => import('../../components/orchestrator/OrchestratorPage').then(module => <module.OrchestratorPage />),
  },
});

export const orchestratorPlugin = createFrontendPlugin({
  pluginId: 'orchestrator',
  title: 'Phoenix Orchestrator',
  icon: <BuildIcon />,
  routes: { root: rootRouteRef },
  extensions: [page],
});

