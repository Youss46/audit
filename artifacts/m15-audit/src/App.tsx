import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { Shell } from '@/components/layout/Shell';
import Dashboard from '@/pages/dashboard';
import Login from '@/pages/login';
import Register from '@/pages/register';
import ForcePasswordChange from '@/pages/force-password-change';
import Clients from '@/pages/clients';
import ClientDetail from '@/pages/client-detail';
import ClientNew from '@/pages/client-new';
import ClientPortal from '@/pages/portal';
import MissionDetail from '@/pages/mission-detail';
import Missions from '@/pages/missions';
import GestionDocumentaire from '@/pages/ged';
import Users from '@/pages/users';
import AuditLog from '@/pages/audit-log';
import Compliance from '@/pages/compliance';
import ComptabilitePme from '@/pages/comptabilite-pme';
import ComptabiliteCabinet from '@/pages/comptabilite-cabinet';
import ComptabiliteJournaux from '@/pages/comptabilite-journaux';
import ComptabiliteGrandLivre from '@/pages/comptabilite-grand-livre';
import ComptabiliteEtatsFinanciers from '@/pages/comptabilite-etats-financiers';
import CaisseExpress from '@/pages/caisse-express';
import PumpIndex from '@/pages/pump-index';
import FuelSales from '@/pages/fuel-sales';
import Pilotage from '@/pages/pilotage';
import Analytique from '@/pages/analytique';
import Immobilisations from '@/pages/immobilisations';
import Financements from '@/pages/financements';
import Paie from '@/pages/paie';
import ClotureAnnuelle from '@/pages/cloture-annuelle';
import Teledeclaration from '@/pages/teledeclaration';
import Rentabilite from '@/pages/rentabilite';
import Dsf from '@/pages/dsf';
import ComptabiliteRevision from '@/pages/comptabilite-revision';
import Scoring from '@/pages/scoring';
import Facturation from '@/pages/facturation';
import ClientStaff from '@/pages/client-staff';
import PumpSettings from '@/pages/pump-settings';
import Communication from '@/pages/communication';
import PayrollSettings from '@/pages/payroll-settings';
import VatSettings from '@/pages/vat-settings';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/force-password-change" component={ForcePasswordChange} />
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
        <Route path="/releve-index" component={PumpIndex} />
        <Route path="/ventes-carburant" component={FuelSales} />
        <Route path="/ventes-carburant/:id" component={FuelSales} />
        <Route path="/pilotage" component={Pilotage} />
        <Route path="/facturation" component={Facturation} />
        <Route path="/client/settings/staff" component={ClientStaff} />
        <Route path="/client/settings/pumps" component={PumpSettings} />
        <Route path="/comptabilite" component={ComptabiliteCabinet} />
        <Route path="/comptabilite/:clientId/saisie" component={ComptabiliteCabinet} />
        <Route path="/comptabilite/:clientId/journaux" component={ComptabiliteJournaux} />
        <Route path="/comptabilite/:clientId/grand-livre" component={ComptabiliteGrandLivre} />
        <Route path="/comptabilite/:clientId/etats-financiers" component={ComptabiliteEtatsFinanciers} />
        <Route path="/immobilisations" component={Immobilisations} />
        <Route path="/cabinet/client/:clientId/immobilisations" component={Immobilisations} />
        <Route path="/financements" component={Financements} />
        <Route path="/cabinet/client/:clientId/finance" component={Financements} />
        <Route path="/dsf" component={Dsf} />
        <Route path="/paie" component={Paie} />
        <Route path="/teledeclaration" component={Teledeclaration} />
        <Route path="/scoring" component={Scoring} />
        <Route path="/cabinet/client/:clientId/paie" component={Paie} />
        <Route path="/cabinet/client/:clientId/cloture" component={ClotureAnnuelle} />
        <Route path="/cabinet/client/:clientId/teledeclaration" component={Teledeclaration} />
        <Route path="/cabinet/client/:clientId/pilotage" component={Pilotage} />
        <Route path="/cabinet/client/:clientId/analytique" component={Analytique} />
        <Route path="/cabinet/client/:clientId/dsf" component={Dsf} />
        <Route path="/cabinet/client/:clientId/revision" component={ComptabiliteRevision} />
        <Route path="/cabinet/client/:clientId/scoring" component={Scoring} />
        <Route path="/cabinet/settings/payroll" component={PayrollSettings} />
        <Route path="/cabinet/settings/vat" component={VatSettings} />
        <Route path="/cabinet/interne/rentabilite" component={Rentabilite} />
        <Route path="/users" component={Users} />
        <Route path="/audit-log" component={AuditLog} />
        <Route path="/cabinet/compliance" component={Compliance} />
        <Route path="/cabinet/communication" component={Communication} />
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
