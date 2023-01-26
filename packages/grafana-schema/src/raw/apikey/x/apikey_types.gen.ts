// Code generated - EDITING IS FUTILE. DO NOT EDIT.
//
// Generated by:
//     kinds/gen.go
// Using jennies:
//     TSTypesJenny
//     LatestMajorsOrXJenny
//
// Run 'make gen-cue' from repository root to regenerate.

/**
 * OrgRole is a Grafana Organization Role which can be 'Viewer', 'Editor', 'Admin'.
 */
export type OrgRole = ('Admin' | 'Editor' | 'Viewer');

export interface APIKey {
  /**
   * AccessControl metadata associated with a given resource.
   */
  accessControl?: Record<string, boolean>;
  /**
   * Expiration indicates when the api key expires.
   */
  expiration?: number;
  /**
   * ID is the unique identifier of the api key in the database.
   */
  id: number;
  /**
   * Name of the api key.
   */
  name: string;
  /**
   * Role is the Grafana organization role of the api key which can be 'Viewer', 'Editor', 'Admin'.
   */
  role: OrgRole;
}
