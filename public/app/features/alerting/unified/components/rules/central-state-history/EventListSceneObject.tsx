import { css } from '@emotion/css';
import { max, min, uniqBy } from 'lodash';
import React, { useMemo, useState } from 'react';
import { useMeasure } from 'react-use';

import {
  DataFrameJSON,
  FieldType,
  GrafanaTheme2,
  LoadingState,
  PanelData,
  TimeRange,
  dateTime,
  makeTimeRange,
} from '@grafana/data';
import { isFetchError } from '@grafana/runtime';
import { SceneComponentProps, SceneObjectBase, TextBoxVariable, VariableValue, sceneGraph } from '@grafana/scenes';
import { Alert, Icon, LoadingBar, Stack, Text, Tooltip, useStyles2, withErrorBoundary } from '@grafana/ui';
import { EntityNotFound } from 'app/core/components/PageNotFound/EntityNotFound';
import { Trans, t } from 'app/core/internationalization';
import {
  GrafanaAlertStateWithReason,
  isAlertStateWithReason,
  isGrafanaAlertState,
  mapStateWithReasonToBaseState,
  mapStateWithReasonToReason,
} from 'app/types/unified-alerting-dto';

import { stateHistoryApi } from '../../../api/stateHistoryApi';
import { useCombinedRule } from '../../../hooks/useCombinedRule';
import { labelsMatchMatchers, parseMatchers } from '../../../utils/alertmanager';
import { GRAFANA_RULES_SOURCE_NAME } from '../../../utils/datasource';
import { stringifyErrorLike } from '../../../utils/misc';
import { hashLabelsOrAnnotations, parse as parseRuleId } from '../../../utils/rule-id';
import { isGrafanaRulerRule } from '../../../utils/rules';
import { AlertLabels } from '../../AlertLabels';
import { CollapseToggle } from '../../CollapseToggle';
import { VizWrapper } from '../../rule-editor/VizWrapper';
import { LogRecord } from '../state-history/common';
import { isLine, isNumbers } from '../state-history/useRuleHistoryRecords';

import { LABELS_FILTER } from './CentralAlertHistoryScene';

export const LIMIT_EVENTS = 5000; //Limit is hard-capped at 5000.

/**
 *
 * This component displays a list of history events.
 * It fetches the events from the history api and displays them in a list.
 * The list is filtered by the labels in the filter variable and by the time range variable in the scene graph.
 */
export const HistoryEventsList = ({
  timeRange,
  valueInfilterTextBox,
}: {
  timeRange?: TimeRange;
  valueInfilterTextBox: VariableValue;
}) => {
  const from = timeRange?.from.unix();
  const to = timeRange?.to.unix();

  const {
    data: stateHistory,
    isLoading,
    isError,
    error,
  } = stateHistoryApi.endpoints.getRuleHistory.useQuery({
    from: from,
    to: to,
    limit: LIMIT_EVENTS,
  });

  const { historyRecords } = useRuleHistoryRecords(stateHistory, valueInfilterTextBox.toString());

  if (isError) {
    return <HistoryErrorMessage error={error} />;
  }

  return (
    <>
      <LoadingIndicator visible={isLoading} />
      <HistoryLogEvents logRecords={historyRecords} />
    </>
  );
};

// todo: this function has been copied from RuleList.v2.tsx, should be moved to a shared location
const LoadingIndicator = ({ visible = false }) => {
  const [measureRef, { width }] = useMeasure<HTMLDivElement>();
  return <div ref={measureRef}>{visible && <LoadingBar width={width} data-testid="loading-bar" />}</div>;
};

interface HistoryLogEventsProps {
  logRecords: LogRecord[];
}
function HistoryLogEvents({ logRecords }: HistoryLogEventsProps) {
  return (
    <ul>
      {logRecords.map((record) => {
        return (
          <EventRow
            key={record.timestamp + hashLabelsOrAnnotations(record.line.labels ?? {})}
            record={record}
            logRecords={logRecords}
          />
        );
      })}
    </ul>
  );
}

interface HistoryErrorMessageProps {
  error: unknown;
}

function HistoryErrorMessage({ error }: HistoryErrorMessageProps) {
  if (isFetchError(error) && error.status === 404) {
    return <EntityNotFound entity="History" />;
  }
  const title = t('central-alert-history.error', 'Something went wrong loading the alert state history');
  const errorStr = stringifyErrorLike(error);

  return (
    <Alert title={title}>
      <Trans i18nKey="central-alert-history.error-message" errorStr={errorStr}>
        {errorStr}
      </Trans>
    </Alert>
  );
}

function EventRow({ record, logRecords }: { record: LogRecord; logRecords: LogRecord[] }) {
  const styles = useStyles2(getStyles);
  const [isCollapsed, setIsCollapsed] = useState(true);
  return (
    <Stack direction="column" gap={0}>
      <div className={styles.header(isCollapsed)} data-testid="event-row-header">
        <CollapseToggle
          size="sm"
          className={styles.collapseToggle}
          isCollapsed={isCollapsed}
          onToggle={setIsCollapsed}
        />
        <Stack gap={0.5} direction={'row'} alignItems={'center'}>
          <div className={styles.timeCol}>
            <Timestamp time={record.timestamp} />
          </div>
          <div className={styles.transitionCol}>
            <EventTransition previous={record.line.previous} current={record.line.current} />
          </div>
          <div className={styles.alertNameCol}>
            {record.line.labels ? <AlertRuleName labels={record.line.labels} ruleUID={record.line.ruleUID} /> : null}
          </div>
          <div className={styles.labelsCol}>
            <AlertLabels labels={record.line.labels ?? {}} size="xs" />
          </div>
        </Stack>
      </div>
      {!isCollapsed && (
        <div className={styles.expandedRow}>
          <EventDetails record={record} logRecords={logRecords} />
        </div>
      )}
    </Stack>
  );
}

function EventDetails({ record, logRecords }: { record: LogRecord; logRecords: LogRecord[] }) {
  const ruleUID = record.line?.ruleUID ?? '';

  const getTransitionsCountByRuleUID = (ruleUID: string) => {
    return logRecords.filter((record) => record.line.ruleUID === ruleUID).length;
  };
  return (
    <Stack direction="column" gap={0.5}>
      <Stack direction={'row'} gap={6}>
        <StateTransition record={record} />
        <ValueInTransition record={record} />
        <NumberTransitions transitions={ruleUID ? getTransitionsCountByRuleUID(ruleUID) : 0} />
      </Stack>
      <QueryVizualization ruleUID={ruleUID} logRecords={logRecords} />
    </Stack>
  );
}

const QueryVizualization = ({ ruleUID, logRecords }: { ruleUID: string; logRecords: LogRecord[] }) => {
  const identifier = React.useMemo(() => {
    return parseRuleId(ruleUID, true);
  }, [ruleUID]);
  const { error, loading, result } = useCombinedRule({ ruleIdentifier: identifier });

  if (error) {
    return (
      <Text>
        <Trans i18nKey="central-alert-history.details.error">Error loading rule</Trans>
      </Text>
    );
  }
  if (loading) {
    return (
      <Text>
        <Trans i18nKey="central-alert-history.details.loading">Loading...</Trans>
      </Text>
    );
  }

  if (!result) {
    // if we get here assume we can't find the rule
    return (
      <Text>
        <Trans i18nKey="central-alert-history.details.not-found">Rule not found</Trans>
      </Text>
    );
  }
  if (!isGrafanaRulerRule(result?.rulerRule)) {
    return (
      <Text>
        <Trans i18nKey="central-alert-history.details.not-grafana-rule">Rule is not a Grafana rule</Trans>
      </Text>
    );
  }
  // get the condition from the rule
  const condition = result?.rulerRule.grafana_alert?.condition ?? 'A';
  // get the panel data for the rule
  const panelData = getPanelDataForRule(ruleUID, logRecords, condition);
  return <VizWrapper data={panelData} thresholds={undefined} thresholdsType={undefined} />;
};

/**
 * This function returns the time series panel data for the condtion values of the rule, within the selected time range.
 * The values are extracted from the log records already fetched from the history api.
 * @param ruleUID
 * @param logRecords
 * @param condition
 * @returns
 */
function getPanelDataForRule(ruleUID: string, logRecords: LogRecord[], condition: string) {
  const ruleLogRecords = logRecords
    .filter((record) => record.line.ruleUID === ruleUID)
    .sort((a, b) => a.timestamp - b.timestamp); // sort by timestamp as time series data is expected to be sorted by time
  // get unique records by timestamp, as timeseries data should have unique timestamps, and it might be possible to have multiple records with the same timestamp
  const uniqueRecords = uniqBy(ruleLogRecords, (record) => record.timestamp);
  const timestamps = uniqueRecords.map((record) => record.timestamp);
  const values = uniqueRecords.map((record) => (record.line.values ? record.line.values[condition] : 0));
  const minTimestamp = min(timestamps);
  const maxTimestamp = max(timestamps);

  const PanelDataObj: PanelData = {
    series: [
      {
        name: 'Rule history',
        fields: [
          { name: 'Time', values: timestamps, config: {}, type: FieldType.time },
          { name: 'values', values: values, type: FieldType.number, config: {} },
        ],
        length: timestamps.length,
      },
    ],
    state: LoadingState.Done,
    timeRange: makeTimeRange(dateTime(minTimestamp), dateTime(maxTimestamp)),
  };
  return PanelDataObj;
}

function ValueInTransition({ record }: { record: LogRecord }) {
  const values = record.line.values ? JSON.stringify(record.line.values) : 'No values';
  return (
    <Stack gap={0.5} direction={'column'}>
      <Text variant="body" weight="light" color="secondary">
        <Trans i18nKey="central-alert-history.details.value-in-transition">Value in transition</Trans>
      </Text>
      <Stack gap={0.5} direction={'row'} alignItems="center">
        <Text variant="body" weight="light">
          <Trans i18nKey="central-alert-history.details.values" values={values}>
            {values}
          </Trans>
        </Text>
      </Stack>
    </Stack>
  );
}

function NumberTransitions({ transitions }: { transitions: number }) {
  return (
    <Stack gap={0.5} direction={'column'} alignItems="flex-start" justifyContent={'center'}>
      <Text variant="body" weight="light" color="secondary">
        <Trans i18nKey="central-alert-history.details.number-transitions">State transitions for selected period</Trans>
      </Text>
      <Text variant="body" weight="light">
        <Trans i18nKey="central-alert-history.details.number-transitions-value" transitions={transitions}>
          {transitions}
        </Trans>
      </Text>
    </Stack>
  );
}

function StateTransition({ record }: { record: LogRecord }) {
  return (
    <Stack gap={0.5} direction={'column'}>
      <Text variant="body" weight="light" color="secondary">
        <Trans i18nKey="central-alert-history.details.state-transitions">State transition</Trans>
      </Text>
      <Stack gap={0.5} direction={'row'} alignItems="center">
        <EventState state={record.line.previous} showLabel />
        <Icon name="arrow-right" size="lg" />
        <EventState state={record.line.current} showLabel />
      </Stack>
    </Stack>
  );
}

function AlertRuleName({ labels, ruleUID }: { labels: Record<string, string>; ruleUID?: string }) {
  const styles = useStyles2(getStyles);
  const alertRuleName = labels['alertname'];
  if (!ruleUID) {
    return (
      <Text>
        <Trans i18nKey="central-alert-history.details.unknown-rule">Unknown</Trans>
        <Trans i18nKey="central-alert-history.details.alert-name" alertRuleName={alertRuleName}>
          {alertRuleName}
        </Trans>
      </Text>
    );
  }
  return (
    <Tooltip content={alertRuleName ?? ''}>
      <a
        href={`/alerting/${GRAFANA_RULES_SOURCE_NAME}/${ruleUID}/view?returnTo=${encodeURIComponent('/alerting/history')}`}
        className={styles.alertName}
      >
        <Trans i18nKey="central-alert-history.details.alert-name" alertRuleName={alertRuleName}>
          {alertRuleName}
        </Trans>
      </a>
    </Tooltip>
  );
}

interface EventTransitionProps {
  previous: GrafanaAlertStateWithReason;
  current: GrafanaAlertStateWithReason;
}
function EventTransition({ previous, current }: EventTransitionProps) {
  return (
    <Stack gap={0.5} direction={'row'}>
      <EventState state={previous} />
      <Icon name="arrow-right" size="lg" />
      <EventState state={current} />
    </Stack>
  );
}

function EventState({ state, showLabel }: { state: GrafanaAlertStateWithReason; showLabel?: boolean }) {
  const styles = useStyles2(getStyles);

  if (!isGrafanaAlertState(state) && !isAlertStateWithReason(state)) {
    return (
      <Tooltip content={'No recognized state'}>
        <Stack gap={0.5} direction={'row'} alignItems="center">
          <Icon name="exclamation-triangle" size="md" />
          {showLabel && (
            <Text variant="body" weight="light">
              <Trans i18nKey="central-alert-history.details.unknown-event-state">Unknown</Trans>
            </Text>
          )}
        </Stack>
      </Tooltip>
    );
  }
  const baseState = mapStateWithReasonToBaseState(state);
  const reason = mapStateWithReasonToReason(state);

  switch (baseState) {
    case 'Normal':
      return (
        <Tooltip content={Boolean(reason) ? `Normal (${reason})` : 'Normal'}>
          <Stack gap={0.5} direction={'row'} alignItems="center">
            <Icon
              name="check-circle"
              size="md"
              className={Boolean(reason) ? styles.warningColor : styles.normalColor}
            />
            {showLabel && (
              <Text variant="body" weight="light">
                <Trans i18nKey="central-alert-history.details.state.normal">Normal</Trans>
              </Text>
            )}
          </Stack>
        </Tooltip>
      );
    case 'Alerting':
      return (
        <Tooltip content={'Alerting'}>
          <Stack gap={0.5} direction={'row'} alignItems="center">
            <Icon name="exclamation-circle" size="md" className={styles.alertingColor} />
            {showLabel && (
              <Text variant="body" weight="light">
                <Trans i18nKey="central-alert-history.details.state.alerting">Alerting</Trans>
              </Text>
            )}
          </Stack>
        </Tooltip>
      );
    case 'NoData': //todo:change icon
      return (
        <Tooltip content={'Insufficient data'}>
          <Stack gap={0.5} direction={'row'} alignItems="center">
            <Icon name="exclamation-triangle" size="md" className={styles.warningColor} />
            {showLabel && (
              <Text variant="body" weight="light">
                <Trans i18nKey="central-alert-history.details.state.no-data">No data</Trans>
              </Text>
            )}
          </Stack>
        </Tooltip>
      );
    case 'Error':
      return (
        <Tooltip content={'Error'}>
          <Stack gap={0.5} direction={'row'} alignItems="center">
            <Icon name="exclamation-circle" size="md" />
            {showLabel && (
              <Text variant="body" weight="light">
                <Trans i18nKey="central-alert-history.details.state.error">Error</Trans>
              </Text>
            )}
          </Stack>
        </Tooltip>
      );

    case 'Pending':
      return (
        <Tooltip content={Boolean(reason) ? `Pending (${reason})` : 'Pending'}>
          <Stack gap={0.5} direction={'row'} alignItems="center">
            <Icon name="circle" size="md" className={styles.warningColor} />
            {showLabel && (
              <Text variant="body" weight="light">
                <Trans i18nKey="central-alert-history.details.state.pending">Pending</Trans>
              </Text>
            )}
          </Stack>
        </Tooltip>
      );
    default:
      return <Icon name="exclamation-triangle" size="md" />;
  }
}

interface TimestampProps {
  time: number; // epoch timestamp
}

const Timestamp = ({ time }: TimestampProps) => {
  const dateTime = new Date(time);
  const formattedDate = dateTime.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <Text variant="body" weight="light">
      <Trans i18nKey="central-alert-history.details.timestamp" formattedDate={formattedDate}>
        {formattedDate}
      </Trans>
    </Text>
  );
};

export default withErrorBoundary(HistoryEventsList, { style: 'page' });

export const getStyles = (theme: GrafanaTheme2) => {
  return {
    header: (isCollapsed: boolean) =>
      css({
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        padding: `${theme.spacing(1)} ${theme.spacing(1)} ${theme.spacing(1)} 0`,
        flexWrap: 'nowrap',
        borderBottom: isCollapsed ? `1px solid ${theme.colors.border.weak}` : 'none',

        '&:hover': {
          backgroundColor: theme.components.table.rowHoverBackground,
        },
      }),

    collapseToggle: css({
      background: 'none',
      border: 'none',
      marginTop: `-${theme.spacing(1)}`,
      marginBottom: `-${theme.spacing(1)}`,

      svg: {
        marginBottom: 0,
      },
    }),
    normalColor: css({
      fill: theme.colors.success.text,
    }),
    warningColor: css({
      fill: theme.colors.warning.text,
    }),
    alertingColor: css({
      fill: theme.colors.error.text,
    }),
    timeCol: css({
      width: '150px',
    }),
    transitionCol: css({
      width: '80px',
    }),
    alertNameCol: css({
      width: '300px',
    }),
    labelsCol: css({
      display: 'flex',
      overflow: 'hidden',
      alignItems: 'center',
      paddingRight: theme.spacing(2),
      flex: 1,
    }),
    alertName: css({
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: 'block',
      color: theme.colors.text.link,
    }),
    expandedRow: css({
      padding: theme.spacing(2),
      marginLeft: theme.spacing(2),
      borderLeft: `1px solid ${theme.colors.border.weak}`,
    }),
  };
};

/**
 * This is a scene object that displays a list of history events.
 */

export class HistoryEventsListObject extends SceneObjectBase {
  public static Component = HistoryEventsListObjectRenderer;
  public constructor() {
    super({});
  }
}

export function HistoryEventsListObjectRenderer({ model }: SceneComponentProps<HistoryEventsListObject>) {
  const { value: timeRange } = sceneGraph.getTimeRange(model).useState(); // get time range from scene graph
  const filtersVariable = sceneGraph.lookupVariable(LABELS_FILTER, model)!;

  const valueInfilterTextBox: VariableValue = !(filtersVariable instanceof TextBoxVariable)
    ? ''
    : filtersVariable.getValue();

  return <HistoryEventsList timeRange={timeRange} valueInfilterTextBox={valueInfilterTextBox} />;
}
function useRuleHistoryRecords(stateHistory?: DataFrameJSON, filter?: string) {
  return useMemo(() => {
    const tsValues = stateHistory?.data?.values[0] ?? [];
    const timestamps: number[] = isNumbers(tsValues) ? tsValues : [];
    const lines = stateHistory?.data?.values[1] ?? [];
    // merge timestamp with "line"
    const logRecords = timestamps.reduce((acc: LogRecord[], timestamp: number, index: number) => {
      const line = lines[index];
      // values property can be undefined for some instance states (e.g. NoData)
      if (isLine(line)) {
        acc.push({ timestamp, line });
      }
      return acc;
    }, []);

    const filterMatchers = filter ? parseMatchers(filter) : [];

    return {
      historyRecords: logRecords.filter(({ line }) => line.labels && labelsMatchMatchers(line.labels, filterMatchers)),
    };
  }, [stateHistory, filter]);
}
