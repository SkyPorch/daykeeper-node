import type { components } from "./generated/schema.js";

type Schemas = components["schemas"];

export type DaykeeperCapabilities = Schemas["Capabilities"];
export type EntitlementStatus = Schemas["EntitlementStatus"];
export type EntitlementPolicy = Schemas["EntitlementPolicy"];
export type UsageStatus = Schemas["UsageStatus"];
export type UsageResourceStatus = Schemas["UsageResourceStatus"];
export type AgentCredentialScope = Schemas["AgentCredentialScope"];
export type AgentCredentialState = Schemas["AgentCredential"]["state"];
export type AgentCredential = Schemas["AgentCredential"];
export type AgentCredentialPage = Schemas["AgentCredentialPage"];
type GeneratedCreateAgentCredentialInput =
  Schemas["CreateAgentCredentialInput"];
/** Scopes only a tenant-bound key may carry; they require `tenantId`. */
export type TenantOnlyAgentCredentialScope = Extract<
  AgentCredentialScope,
  "daykeeper.lifecycle:write" | "daykeeper.customers:delete"
>;
/** Every scope a tenant-bound key (one created with `tenantId`) may carry. */
export type TenantAgentCredentialScope = Extract<
  AgentCredentialScope,
  "daykeeper.customer-sessions:write" | TenantOnlyAgentCredentialScope
>;
/** Every scope an organization-wide key (no `tenantId`) may carry. */
export type OrganizationAgentCredentialScope = Exclude<
  AgentCredentialScope,
  TenantOnlyAgentCredentialScope
>;
type CreateAgentCredentialFields = {
  name: GeneratedCreateAgentCredentialInput["name"];
  /**
   * Days until the credential expires, 1 through 365. Omitted or `null`, the
   * credential lasts until it is revoked.
   */
  validityDays?: GeneratedCreateAgentCredentialInput["validityDays"];
};
/**
 * An organization-wide key, or one bound to a tenant with `tenantId`. The
 * contract's conditional rules generate no types, so they are spelled out
 * here: lifecycle and customer-deletion scopes require `tenantId`, and a
 * tenant-bound key may carry only customer-session, lifecycle and
 * customer-deletion scopes. The server rejects anything else.
 */
export type CreateAgentCredentialInput =
  | (CreateAgentCredentialFields & {
      tenantId?: undefined;
      scopes: OrganizationAgentCredentialScope[];
    })
  | (CreateAgentCredentialFields & {
      tenantId: string;
      scopes: TenantAgentCredentialScope[];
    });
export type CreateAgentCredentialResult =
  Schemas["CreateAgentCredentialResult"];
export type RevokeAgentCredentialResult =
  Schemas["RevokeAgentCredentialResult"];
type GeneratedRotateAgentCredentialInput =
  Schemas["RotateAgentCredentialInput"];
export type RotateAgentCredentialInput = {
  /**
   * Hours the previous key keeps working, 0 through 168. Omitted, the server
   * default of 24 applies; 0 revokes the previous key at once. A key rotating
   * itself must pass at least 1: 0 revokes the caller, so a lost response
   * leaves it no way to recover, and a server may reject it.
   */
  overlapHours?: GeneratedRotateAgentCredentialInput["overlapHours"];
  /**
   * Days until the new credential expires, 1 through 365; `null` lasts until
   * it is revoked. Omitted keeps the rotated key's policy. A key rotating
   * itself never gets a later expiry than it already had.
   */
  validityDays?: GeneratedRotateAgentCredentialInput["validityDays"];
};
/** `token` is the new key's secret, revealed once; `null` on a replay. */
export type RotateAgentCredentialResult =
  Schemas["RotateAgentCredentialResult"];
export type WorkspaceClaim = Schemas["WorkspaceClaim"];
export type WorkspaceClaimState = Schemas["WorkspaceClaim"]["state"];
export type CreateWorkspaceClaimInput = Schemas["CreateWorkspaceClaimInput"];
/** The result of a fresh claim application, the 201 body. `token` and
 * `claimUrl` are revealed exactly once and `replayed` is always false. Never
 * log or persist either value. */
export type WorkspaceClaimCreated = Schemas["WorkspaceClaimCreated"];
/** The result of an exact repeat under the same idempotency key, the 200 body.
 * `token` and `claimUrl` are always null and `replayed` is always true; the
 * secret cannot be recovered. */
export type WorkspaceClaimReplayed = Schemas["WorkspaceClaimReplayed"];
/** A workspace claim result: the union of the fresh and replayed shapes,
 * discriminated by `replayed`. Narrow on `replayed === false` to reach a
 * non-null `token` and `claimUrl`. Never log or persist either value. */
export type WorkspaceClaimResult = Schemas["WorkspaceClaimResult"];
export type WorkspaceClaimList = Schemas["WorkspaceClaimList"];
export type DomainVerification = Schemas["DomainVerification"];
export type DomainVerificationInput = Schemas["DomainVerificationInput"];
export type MachinePublicKey = Schemas["MachinePublicKey"];
export type MachineEnrollmentInput = Schemas["MachineEnrollmentInput"];
export type MachineChallenge = Schemas["MachineChallenge"];
export type MachineProofInput = Schemas["MachineProofInput"];
export type MachineEnrollmentResult = Schemas["MachineEnrollmentResult"];
export type MachineRotationInput = Schemas["MachineRotationInput"];
export type MachineRotationResult = Schemas["MachineRotationResult"];
export type MachineCredentialMetadata = Schemas["MachineCredentialMetadata"];
export type WebsiteInboxSpec = Schemas["WebsiteInboxSpec"];
export type WebsiteChannel = Schemas["WebsiteChannel"];
export type ApiInboxSpec = Schemas["ApiInboxSpec"];
export type InboxChannel = Schemas["InboxChannel"];
export type DaykeeperScope = Schemas["DaykeeperScope"];
export type TenantSpec = Schemas["TenantSpec"];
export type TenantState = Schemas["Tenant"]["state"];
export type Tenant = Schemas["Tenant"];
export type PlanChange = Schemas["PlanChange"];
export type TenantPlan = Schemas["TenantPlan"];
export type ApplyPlanInput = Schemas["ApplyPlanInput"];
export type EmailChannelSpec = Schemas["EmailChannelSpec"];
export type DnsRecord = Schemas["DnsRecord"];
export type EmailChannelState = Schemas["EmailChannel"]["state"];
export type EmailChannelVerification = Schemas["EmailChannelVerification"];
export type EmailChannel = Schemas["EmailChannel"];
export type EmailChannelPlan = Schemas["EmailChannelPlan"];
export type OperationState = Schemas["Operation"]["state"];
export type OperationStepState = Schemas["OperationStep"]["state"];
export type OperationError = Schemas["OperationError"];
export type OperationStep = Schemas["OperationStep"];
export type Operation = Schemas["Operation"];
export type ApplyTenantResult = Schemas["ApplyTenantResult"];
export type ApplyEmailChannelResult = Schemas["ApplyEmailChannelResult"];
export type CustomerSessionPurpose =
  Schemas["CreateCustomerSessionInput"]["purpose"];
export type CreateCustomerSessionInput = Schemas["CreateCustomerSessionInput"];
export type CustomerSession = Schemas["CustomerSession"];

export type ApiInboxActivationReceipt = Schemas["ApiInboxActivation"];
export type ApiInboxActivationState = ApiInboxActivationReceipt["state"];

export interface OperatorConversation {
  id: number;
  status: string;
  preview: string;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
}

export interface OperatorMessage {
  id: number;
  conversationId: number;
  senderType: string;
  messageType: number;
  content: string;
  createdAt: string;
}

export interface OperatorConversationList {
  tenantId: string;
  conversations: readonly OperatorConversation[];
}

export interface OperatorConversationMessages {
  tenantId: string;
  conversationId: number;
  messages: readonly OperatorMessage[];
}

export interface OperatorConversationReply {
  tenantId: string;
  conversationId: number;
  message: OperatorMessage;
}

export const DAYKEEPER_FLOW_SCHEMA_VERSION = "2026-08-01" as const;

export type FlowCondition = Schemas["FlowCondition"];
export type FlowConditionField = FlowCondition["field"];
export type FlowAction = Schemas["FlowAction"];
export type FlowDefinition = Schemas["FlowDefinition"];
export type FlowState = Schemas["Flow"]["state"];
export type Flow = Schemas["Flow"];
export type FlowVersion = Schemas["FlowVersion"];
export type FlowWithVersion = Schemas["FlowWithVersion"];
/** A flow mutation result. `replayed` is true when the server returned the
 * stored result of an earlier identical request instead of applying a new one. */
export type FlowMutationResult = Schemas["FlowMutationResult"];
export type CreateFlowInput = Schemas["CreateFlowInput"];
export type CreateFlowVersionInput = Schemas["CreateFlowVersionInput"];
export type PublishFlowVersionInput = Schemas["PublishFlowVersionInput"];
