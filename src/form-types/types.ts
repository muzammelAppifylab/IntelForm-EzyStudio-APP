import type {ComponentType} from 'react';

import type {QuestionSummary} from '../lib/intelform/api-responses';
import type {FieldType} from '../lib/intelform/form/field-types';
import type {
  ConditionValueComponent,
  ConditionValueProps,
  FieldSettingsComponent,
  FieldSettingsProps,
} from '../portal/intelform/builder/type-ui';
import type {ChangeMeta, FieldRendererProps} from '../respondent/types';

/**
 * The contracts every field type folder (src/form-types/<type>/) implements, in one place:
 *
 *   Renderer.tsx        default export: ComponentType<FieldRendererProps<'<type>'>>  (respondent)
 *   Settings.tsx        default export: FieldSettingsComponent<'<type>'>             (builder panel)
 *   ConditionValue.tsx  default export: ConditionValueComponent<'<type>'>            (logic editor)
 *
 * The registries that collect them are src/form-types/{renderers,settings}.tsx. Responses → Summary
 * cards are picked by the summary's data kind (CARD_BY_KIND in src/portal/intelform/responses/cards.tsx).
 */
export type {
  ChangeMeta,
  ConditionValueComponent,
  ConditionValueProps,
  FieldRendererProps,
  FieldSettingsComponent,
  FieldSettingsProps,
};
export {AUTO_ADVANCE_TYPES, isGroupField, MULTILINE_TYPES} from '../respondent/types';

/** Props of a Responses → Summary card (legacy: src/pages/builder/responses/cards.tsx). */
export interface SummaryCardProps {
  question: QuestionSummary;
  /** Responses in the selected range: the denominator for counts like "signed". */
  totalResponses: number;
  /** Open the table filtered to this value (option id, "true"/"false", country code, score). */
  onFilter: (fieldId: string, value: string) => void;
  /** Open the table showing only responses that answered this question. */
  onViewAll: (fieldId: string) => void;
  onOpenResponse: (responseId: string) => void;
}

export type FieldRendererComponent<T extends FieldType = FieldType> = ComponentType<FieldRendererProps<T>>;

/** Registry shapes, so each registry file can be typed without repeating the mapped types. */
export type RendererRegistry = Record<FieldType, ComponentType<FieldRendererProps>>;
export type SettingsRegistry = {[K in FieldType]: FieldSettingsComponent<K>};
export type ConditionValueRegistry = {[K in FieldType]?: ConditionValueComponent<K>};
