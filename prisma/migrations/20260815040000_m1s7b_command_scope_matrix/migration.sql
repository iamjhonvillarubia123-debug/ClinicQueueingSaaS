-- M1S7B COMMAND IDEMPOTENCY SCOPE MATRIX
--
-- Installs stable same-row CHECK constraints only where the approved
-- CommandIdempotency authority defines an exact row shape.
--
-- Phase 3 practice/service/schedule governance commands are intentionally
-- excluded from this CHECK because the approved CommandIdempotency source
-- does not define one exact persisted-field matrix for those 16 commands.
-- Their scope remains application-validated until the relevant canonical
-- scope fields are implemented/reconciled.
--
-- Cross-table ownership/authorization remains application-service logic.

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_command_scope_matrix_check"
  CHECK (
    CASE "commandType"

      -- ------------------------------------------------------------
      -- BASE BOOKING / QUEUE COMMANDS
      -- ------------------------------------------------------------

      WHEN 'CONVERT_BOOKING_DRAFT' THEN
        "bookingDraftId" IS NOT NULL
        AND "actorUserId" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'CREATE_STAFF_APPOINTMENT' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "bookingDraftId" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'NEXT_PATIENT' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NULL
        AND "resultQueueEventId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'SELF_SERVICE_REINSERTION' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "appointmentId" IS NOT NULL
        AND "actorUserId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NOT NULL
        AND "resultQueueEventId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'RETURN_TO_QUEUE' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "appointmentId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultQueueEventId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'STAFF_REINSERTION' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "appointmentId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultQueueEventId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'UNDO' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NULL
        AND "resultQueueEventId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'CLOSE_CLINIC' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'CANCEL_CLINIC_DAY' THEN
        "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'COMPLETE_APPOINTMENT_RECOVERY' THEN
        "bookingRecoveryAttemptId" IS NOT NULL
        AND "bookingDraftId" IS NULL
        AND "actorUserId" IS NULL
        AND "accountUserId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NOT NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      -- ------------------------------------------------------------
      -- PHASE 1 ACCOUNT LIFECYCLE
      -- ------------------------------------------------------------

      WHEN 'DOCTOR_DISABLE_ACCOUNT' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NULL
        AND "resultQueueEventId" IS NULL
        AND "resultBookingGroupId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'DOCTOR_REACTIVATE_ACCOUNT' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'DOCTOR_DELETE_ACCOUNT' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'SECRETARY_DISABLE_ACCOUNT' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'SECRETARY_REACTIVATE_ACCOUNT' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'SECRETARY_DELETE_ACCOUNT' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'SYSTEM_ADMIN_NORMAL_SUSPEND_DOCTOR' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "resultAdministrativeAccountActionId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL

      WHEN 'SYSTEM_ADMIN_NORMAL_RESTORE_DOCTOR' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "resultAdministrativeAccountActionId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL

      WHEN 'SYSTEM_ADMIN_EMERGENCY_SUSPEND_DOCTOR' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "resultAdministrativeAccountActionId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL

      WHEN 'SYSTEM_ADMIN_EMERGENCY_RESTORE_DOCTOR' THEN
        "accountUserId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "resultAdministrativeAccountActionId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "doctorFinancialAccountId" IS NULL

      -- ------------------------------------------------------------
      -- PHASE 2 BOOKING GROUP
      -- ------------------------------------------------------------

      WHEN 'MULTI_PERSON_BOOKING_CONFIRM' THEN
        "bookingDraftId" IS NOT NULL
        AND "resultBookingGroupId" IS NOT NULL
        AND "appointmentId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "actorUserId" IS NULL
        AND "accountUserId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'BOOKING_GROUP_ADD_PERSON' THEN
        "bookingGroupId" IS NOT NULL
        AND "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "resultBookingGroupId" IS NOT NULL
        AND "resultAppointmentId" IS NOT NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "actorUserId" IS NULL
        AND "accountUserId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'BOOKING_GROUP_CANCEL_MEMBER' THEN
        "bookingGroupId" IS NOT NULL
        AND "appointmentId" IS NOT NULL
        AND "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "resultBookingGroupId" IS NOT NULL
        AND "resultAppointmentId" IS NOT NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "actorUserId" IS NULL
        AND "accountUserId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultBookingGroupAccessTokenId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'BOOKING_GROUP_RECOVERY_COMPLETE' THEN
        "bookingGroupRecoveryAttemptId" IS NOT NULL
        AND "practiceLocationId" IS NOT NULL
        AND "serviceDate" IS NOT NULL
        AND "resultBookingGroupId" IS NOT NULL
        AND "resultBookingGroupAccessTokenId" IS NOT NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "actorUserId" IS NULL
        AND "accountUserId" IS NULL
        AND "doctorFinancialAccountId" IS NULL
        AND "resultAppointmentId" IS NULL
        AND "resultQueueEventId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL
        AND (
          "bookingGroupId" IS NULL
          OR "bookingGroupId" = "resultBookingGroupId"
        )

      -- ------------------------------------------------------------
      -- PHASE 4 FINANCIAL COMMANDS
      -- Scope fields are defined; exact RefundRequest target identity is
      -- not represented by a dedicated CommandIdempotency column.
      -- ------------------------------------------------------------

      WHEN 'DOCTOR_PURCHASE_SUBSCRIPTION' THEN
        "actorUserId" IS NOT NULL
        AND "accountUserId" IS NOT NULL
        AND "doctorFinancialAccountId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'DOCTOR_REQUEST_REFUND' THEN
        "actorUserId" IS NULL
        AND "accountUserId" IS NULL
        AND "doctorFinancialAccountId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'SYSTEM_ADMIN_COMPLETE_REFUND' THEN
        "actorUserId" IS NOT NULL
        AND "accountUserId" IS NULL
        AND "doctorFinancialAccountId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'SYSTEM_ADMIN_FAIL_REFUND' THEN
        "actorUserId" IS NOT NULL
        AND "accountUserId" IS NULL
        AND "doctorFinancialAccountId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      WHEN 'DOCTOR_RECOVER_SUBSCRIPTION_CREDIT' THEN
        "actorUserId" IS NOT NULL
        AND "accountUserId" IS NOT NULL
        AND "doctorFinancialAccountId" IS NOT NULL
        AND "practiceLocationId" IS NULL
        AND "serviceDate" IS NULL
        AND "appointmentId" IS NULL
        AND "bookingDraftId" IS NULL
        AND "bookingRecoveryAttemptId" IS NULL
        AND "bookingGroupId" IS NULL
        AND "bookingGroupRecoveryAttemptId" IS NULL
        AND "resultAdministrativeAccountActionId" IS NULL

      -- ------------------------------------------------------------
      -- PHASE 3 GOVERNANCE
      -- Exact per-command persisted-field matrix is not defined by the
      -- approved CommandIdempotency source. Preserve those rows for
      -- application validation instead of inventing database semantics.
      -- ------------------------------------------------------------

      WHEN 'PRACTICE_LOCATION_ACTIVATE' THEN TRUE
      WHEN 'PRACTICE_LOCATION_DISABLE' THEN TRUE
      WHEN 'PRACTICE_LOCATION_REACTIVATE' THEN TRUE
      WHEN 'PRACTICE_LOCATION_DELETE' THEN TRUE
      WHEN 'PRACTICE_LOCATION_UPDATE_SETTINGS' THEN TRUE
      WHEN 'PRACTICE_LOCATION_APPROVE_SETTINGS_DRAFT' THEN TRUE
      WHEN 'PRACTICE_LOCATION_REJECT_SETTINGS_DRAFT' THEN TRUE
      WHEN 'PRACTICE_LOCATION_RETURN_SETTINGS_DRAFT' THEN TRUE
      WHEN 'PRACTICE_LOCATION_ASSIGN_REGULAR_SECRETARY' THEN TRUE
      WHEN 'PRACTICE_LOCATION_REPLACE_REGULAR_SECRETARY' THEN TRUE
      WHEN 'PRACTICE_LOCATION_REMOVE_REGULAR_SECRETARY' THEN TRUE
      WHEN 'CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY' THEN TRUE
      WHEN 'CLINIC_DAY_REPLACE_SUBSTITUTE_SECRETARY' THEN TRUE
      WHEN 'CLINIC_DAY_END_SUBSTITUTE_SECRETARY' THEN TRUE
      WHEN 'DOCTOR_DEFAULTS_APPLY' THEN TRUE
      WHEN 'DOCTOR_CALENDAR_UPDATE' THEN TRUE

      ELSE FALSE
    END
  );
