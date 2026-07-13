import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { Shell } from '@/components/layout/Shell';
import Dashboard from '@/pages/dashboard';
import Login from '@/pages/login';
import Register from '@/pages/register';
import Clients from '@/pages/clients';
import ClientDetail from '@/pages/client-detail';
import ClientNew from '@/pages/client-new';
import ClientPortal from '@/pages/portal';
import MissionDetail from '@/pages/mission-detail';
import Missions from '@/pages/missions';
import GestionDocumentaire from '@/pages/ged';
import Users from '@/pages/users';
import AuditLog from '@/pages/audit-log';
import ComptabilitePme from '@/pages/comptabilite-pme';
import ComptabiliteCabinet from '@/pages/comptabilite-cabinet';
import CaisseExpress from '@/pages/caisse-express';
import Pilotage from '@/pages/pilotage';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/clients" component={Clients} />
        <Route path="/clients/new" component={ClientNew} />
        <Route path="/clients/:id" component={ClientDetail} />
        <Route path="/clients/:id/missions/:missionId" component={MissionDetail} />
        <Route path="/missions" component={Missions} />
        <Route path="/documents" component={GestionDocumentaire} />
        <Route path="/portal" component={ClientPortal} />
        <Route path="/mes-operations" component={ComptabilitePme} />
        <Route path="/caisse" component={CaisseExpress} />
        <Route path="/pilotage" component={Pilotage} />
        <Route path="/comptabilite" component={ComptabiliteCabinet} />
        <Route path="/users" component={Users} />
        <Route path="/audit-log" component={AuditLog} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
