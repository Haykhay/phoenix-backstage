import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Content,
  Header,
  InfoCard,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { Button, TextField, makeStyles } from '@material-ui/core';

import {
  createOrchestratorClient,
  type OrchestratorRequest,
} from './api';

const useStyles = makeStyles(theme => ({
  table: { width: '100%', borderCollapse: 'collapse' },
  cell: { padding: theme.spacing(1), borderBottom: `1px solid ${theme.palette.divider}`, textAlign: 'left' },
  actions: { display: 'flex', gap: theme.spacing(1), flexWrap: 'wrap' },
  form: { display: 'grid', gap: theme.spacing(2), maxWidth: 720 },
  code: { overflowWrap: 'anywhere' },
}));

export function OrchestratorPage() {
  const classes = useStyles();
  const fetchApi = useApi(fetchApiRef);
  const client = useMemo(() => createOrchestratorClient(fetchApi), [fetchApi]);
  const [requests, setRequests] = useState<OrchestratorRequest[]>();
  const [error, setError] = useState<Error>();

  const refresh = useCallback(async () => {
    try {
      setRequests(await client.list());
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (operation: () => Promise<unknown>) => {
    try { await operation(); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught : new Error(String(caught))); }
  };

  return (
    <Page themeId="tool">
      <Header title="Phoenix orchestration" subtitle="Deployments, approvals, retention, and reclamation" />
      <Content>
        {error && <ResponseErrorPanel error={error} />}
        {!requests ? <Progress /> : (
          <InfoCard title="Requests">
            {requests.length === 0 ? <p>No orchestration requests yet.</p> : (
              <table className={classes.table}>
                <caption className="sr-only">Phoenix orchestration requests</caption>
                <thead><tr><th className={classes.cell}>Request</th><th className={classes.cell}>Action</th><th className={classes.cell}>Tier</th><th className={classes.cell}>Status</th><th className={classes.cell}>Actions</th></tr></thead>
                <tbody>{requests.map(request => (
                  <tr key={request.id}>
                    <td className={`${classes.cell} ${classes.code}`}><code>{request.id}</code></td>
                    <td className={classes.cell}>{request.action}</td>
                    <td className={classes.cell}>{request.tier}</td>
                    <td className={classes.cell}>{request.status}</td>
                    <td className={`${classes.cell} ${classes.actions}`}>
                      {request.status === 'pending_approval' && request.gates.map(gate => (
                        <span key={gate.group} className={classes.actions}>
                          <Button variant="contained" color="primary" onClick={() => void act(() => client.decide(request.id, gate.group, 'approved'))}>Approve {gate.reason}</Button>
                          <Button variant="outlined" color="secondary" onClick={() => void act(() => client.decide(request.id, gate.group, 'rejected'))}>Reject</Button>
                        </span>
                      ))}
                      {request.status === 'failed' && <Button variant="contained" onClick={() => void act(() => client.retry(request.id))}>Retry failed unit</Button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </InfoCard>
        )}
        <RetentionForm onSubmit={input => act(() => client.retain(input))} />
      </Content>
    </Page>
  );
}

function RetentionForm({ onSubmit }: { onSubmit(input: Parameters<ReturnType<typeof createOrchestratorClient>['retain']>[0]): Promise<void> }) {
  const classes = useStyles();
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');
  const [commit, setCommit] = useState('');
  const [units, setUnits] = useState('');
  return (
    <InfoCard title="Request weekend retention">
      <form className={classes.form} onSubmit={event => {
        event.preventDefault();
        void onSubmit({
          tier: 'sandbox', reason, retentionExpiresAt: new Date(expires).toISOString(),
          source: { owner: 'Haykhay', repo: 'phoenix-aws', commit },
          units: units.split('\n').map(path => path.trim()).filter(Boolean).map(path => ({ path })),
        });
      }}>
        <TextField required label="Reason" value={reason} onChange={event => setReason(event.target.value)} multiline />
        <TextField required label="Expires" type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField required label="Approved commit" value={commit} onChange={event => setCommit(event.target.value)} />
        <TextField required label="Unit paths (one per line)" value={units} onChange={event => setUnits(event.target.value)} multiline minRows={4} />
        <Button type="submit" color="primary" variant="contained">Request approval</Button>
      </form>
    </InfoCard>
  );
}

