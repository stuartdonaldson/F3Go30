## clasp login
Usage: clasp login [options]

Log in to script.google.com

Options:
  --no-localhost           Do not run a local server, manually enter code
                           instead
  --creds <file>           Relative path to OAuth client secret file (from GCP).
  --use-project-scopes     Use the scopes from the current project manifest.
                           Used only when authorizing access for the run
                           command.
  --include-clasp-scopes   Include default clasp scopes in addition to project
                           scopes. Can only be used with --use-project-scopes.
  --extra-scopes <scopes>  Include additional OAuth scopes as a comma-separated
                           list.
  --redirect-port <port>   Specify a custom port for the redirect URL.
  -h, --help               display help for command


## clasp logout
Usage: clasp logout [options]

Logout of clasp

Options:
  -h, --help  display help for command


## clasp open-credentials-setup
Usage: clasp open-credentials-setup [options]

Open credentials page for the script's GCP project

Options:
  -h, --help  display help for command


## clasp clone
Usage: clasp clone-script|clone [options] [scriptId] [versionNumber]

Clone an existing script

Options:
  --rootDir <rootDir>  Local root directory in which clasp will store your
                       project files.
  -h, --help           display help for command


## clasp create
Usage: clasp create-script|create [options]

Create a script

Options:
  --type <type>        Creates a new Apps Script project attached to a new
                       Document, Spreadsheet, Presentation, Form, or as a
                       standalone script, web app, or API. (default:
                       "standalone")
  --title <title>      The project title.
  --parentId <id>      A project parent Id.
  --rootDir <rootDir>  Local root directory in which clasp will store your
                       project files.
  -h, --help           display help for command


## clasp push
Usage: clasp push [options]

Update the remote project

Options:
  -f, --force  Forcibly overwrites the remote manifest.
  -w, --watch  Watches for local file changes. Pushes when a non-ignored file
               changes.
  -h, --help   display help for command


## clasp pull
Usage: clasp pull [options]

Fetch a remote project

Options:
  --versionNumber <version>  The version number of the project to retrieve.
  -d, --deleteUnusedFiles    Delete local files that are not in the remote
                             project. Use with caution.
  -f, --force                Forcibly delete local files that are not in the
                             remote project without prompting.
  -h, --help                 display help for command


## clasp create-deployment
Usage: clasp create-deployment|deploy [options]

Deploy a project

Options:
  -V, --versionNumber <version>    The project version
  -d, --description <description>  The deployment description
  -i, --deploymentId <id>          The deployment ID to redeploy
  -h, --help                       display help for command


## clasp delete-script
Usage: clasp delete-script|delete [options] [scriptId]

Delete a project

Arguments:
  scriptId     Apps Script ID to list deployments for

Options:
  -f, --force  Bypass any confirmation messages. It's not a good idea to do this
               unless you want to run clasp from a script.
  -h, --help   display help for command


## clasp delete
Usage: clasp delete-script|delete [options] [scriptId]

Delete a project

Arguments:
  scriptId     Apps Script ID to list deployments for

Options:
  -f, --force  Bypass any confirmation messages. It's not a good idea to do this
               unless you want to run clasp from a script.
  -h, --help   display help for command


## clasp delete-deployment
Usage: clasp delete-deployment|undeploy [options] [deploymentId]

Delete a deployment of a project

Options:
  -a, --all   Undeploy all deployments
  -h, --help  display help for command


## clasp list-deployments
Usage: clasp list-deployments|deployments [options] [scriptId]

List deployment ids of a script

Arguments:
  scriptId    Apps Script ID to list deployments for

Options:
  -h, --help  display help for command


## clasp update-deployment
Usage: clasp update-deployment|redeploy [options] <deploymentId>

Updates a deployment for a project to a new version

Options:
  -V, --versionNumber <version>    The project version
  -d, --description <description>  The deployment description
  --json                           Show output in JSON format
  -h, --help                       display help for command


## clasp disable-api
Usage: clasp disable-api [options] <api>

Disable a service for the current project.

Arguments:
  api         Service to disable

Options:
  -h, --help  display help for command


## clasp enable-api
Usage: clasp enable-api [options] <api>

Enable a service for the current project.

Arguments:
  api         Service to enable

Options:
  -h, --help  display help for command


## clasp list-apis
Usage: clasp list-apis|apis [options]

List enabled APIs for the current project

Options:
  -h, --help  display help for command


## clasp open-api-console
Usage: clasp open-api-console [options]

Open the API console for the current project.

Options:
  -h, --help  display help for command


## clasp show-authorized-user
Usage: clasp show-authorized-user [options]

Show information about the current authorizations state.

Options:
  -h, --help  display help for command


## clasp show-file-status
Usage: clasp show-file-status|status [options]

Lists files that will be pushed by clasp

Options:
  -h, --help  display help for command


## clasp open-logs
Usage: clasp open-logs [options]

Open logs in the developer console

Options:
  -h, --help  display help for command


## clasp setup-logs
Usage: clasp setup-logs [options]

Setup Cloud Logging

Options:
  -h, --help  display help for command


## clasp tail-logs
Usage: clasp tail-logs|logs [options]

Print the most recent log entries

Options:
  --watch       Watch and print new logs
  --simplified  Hide timestamps with logs
  -h, --help    display help for command


## clasp open-script
Usage: clasp open-script [options] [scriptId]

Open the Apps Script IDE for the current project.

Options:
  -h, --help  display help for command


## clasp open-container
Usage: clasp open-container [options]

Open the Apps Script IDE for the current project.

Options:
  -h, --help  display help for command


## clasp open-web-app
Usage: clasp open-web-app [options] [deploymentId]

Open a deployed web app in the browser.

Options:
  -h, --help  display help for command


## clasp run-function
Usage: clasp run-function|run [options] [functionName]

Run a function in your Apps Scripts project

Arguments:
  functionName          The name of the function to run

Options:
  --nondev              Run script function in non-devMode
  -p, --params <value>  Parameters to pass to the function, as a JSON-encoded
                        array
  -h, --help            display help for command


## clasp list-scripts
Usage: clasp list-scripts|list [options]

List Apps Script projects

Options:
  --noShorten  Do not shorten long names (default: false)
  -h, --help   display help for command


## clasp create-version
Usage: clasp create-version|version [options] [description]

Creates an immutable version of the script

Options:
  -h, --help  display help for command


## clasp list-versions
Usage: clasp list-versions|versions [options] [scriptId]

List versions of a script

Arguments:
  scriptId    Apps Script ID to list deployments for

Options:
  -h, --help  display help for command


## clasp start-mcp-server
Usage: clasp start-mcp-server|mcp [options]

Starts an MCP server for interacting with apps script.

Options:
  -h, --help  display help for command


## clasp help
Usage: clasp <command> [options]

clasp - The Apps Script CLI

Options:
  -v, --version                                            output the current version
  -A, --auth <file>                                        path to an auth file or a folder with a '.clasprc.json' file. (env: clasp_config_auth)
  -u,--user <name>                                         Store named credentials. If unspecified, the "default" user is used. (default: "default")
  --adc                                                    Use the application default credentials from the environemnt.
  --json                                                   Show output in JSON format
  -I, --ignore <file>                                      path to an ignore file or a folder with a '.claspignore' file. (env: clasp_config_ignore)
  -P, --project <file>                                     path to a project file or to a folder with a '.clasp.json' file. (env: clasp_config_project)
  -h, --help                                               display help for command

Commands:
  login [options]                                          Log in to script.google.com
  logout                                                   Logout of clasp
  open-credentials-setup                                   Open credentials page for the script's GCP project
  clone-script|clone [options] [scriptId] [versionNumber]  Clone an existing script
  create-script|create [options]                           Create a script
  push [options]                                           Update the remote project
  pull [options]                                           Fetch a remote project
  create-deployment|deploy [options]                       Deploy a project
  delete-script|delete [options] [scriptId]                Delete a project
  delete-deployment|undeploy [options] [deploymentId]      Delete a deployment of a project
  list-deployments|deployments [scriptId]                  List deployment ids of a script
  update-deployment|redeploy [options] <deploymentId>      Updates a deployment for a project to a new version
  disable-api <api>                                        Disable a service for the current project.
  enable-api <api>                                         Enable a service for the current project.
  list-apis|apis                                           List enabled APIs for the current project
  open-api-console                                         Open the API console for the current project.
  show-authorized-user                                     Show information about the current authorizations state.
  show-file-status|status                                  Lists files that will be pushed by clasp
  open-logs                                                Open logs in the developer console
  setup-logs                                               Setup Cloud Logging
  tail-logs|logs [options]                                 Print the most recent log entries
  open-script [scriptId]                                   Open the Apps Script IDE for the current project.
  open-container                                           Open the Apps Script IDE for the current project.
  open-web-app [deploymentId]                              Open a deployed web app in the browser.
  run-function|run [options] [functionName]                Run a function in your Apps Scripts project
  list-scripts|list [options]                              List Apps Script projects
  create-version|version [description]                     Creates an immutable version of the script
  list-versions|versions [scriptId]                        List versions of a script
  start-mcp-server|mcp                                     Starts an MCP server for interacting with apps script.
  help [command]                                           display help for command


