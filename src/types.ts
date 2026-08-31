import type { components } from "./generated/schema.js";

type Schemas = components["schemas"];

export type DaykeeperCapabilities = Schemas["Capabilities"];
export type EntitlementStatus = Schemas["EntitlementStatus"];
export type EntitlementPolicy = Schemas["EntitlementPolicy"];
export type UsageStatus = Schemas["UsageStatus"];
export type UsageResourceStatus = Schemas["UsageResourceStatus"];
export type WebsiteInboxSpec = Schemas["WebsiteInboxSpec"];
export type WebsiteChannel = Schemas["WebsiteChannel"];
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

export const DAYKEEPER_FLOW_SCHEMA_VERSION = "2026-08-01" as const;

export type FlowCondition = Schemas["FlowCondition"];
export type FlowConditionField = FlowCondition["field"];
export type FlowAction = Schemas["FlowAction"];
export type FlowDefinition = Schemas["FlowDefinition"];
export type FlowState = Schemas["Flow"]["state"];
export type Flow = Schemas["Flow"];
export type FlowVersion = Schemas["FlowVersion"];
export type FlowWithVersion = Schemas["FlowWithVersion"];
export type CreateFlowInput = Schemas["CreateFlowInput"];
export type CreateFlowVersionInput = Schemas["CreateFlowVersionInput"];
export type PublishFlowVersionInput = Schemas["PublishFlowVersionInput"];
