# Account request for the ${{ values.group }} group — committed by Backstage.
# AFT vends the account via Control Tower; no account ID here (Control Tower
# assigns it, CI writes it to the registry).
module "${{ values.group }}" {
  source = "./modules/account-request"

  group        = "${{ values.group }}"
  email        = "${{ values.email }}"
  ou           = "${{ values.ou }}"
  organisation = "${{ values.organisation }}"
  base_domain  = "${{ values.base_domain }}"
  apps_repo    = "${{ values.apps_repo }}"
}
