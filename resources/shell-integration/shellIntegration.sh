# Adnify shell integration for bash and zsh, following VS Code's OSC 633 model.
# This file is intentionally POSIX-shell compatible so one script works in both
# bash and zsh without requiring user rc-files to be modified.

__adnify_shell_integration_emit() {
  printf '\033]633;%s\007' "$1"
}

__adnify_shell_integration_emit_with_payload() {
  printf '\033]633;%s;%s\007' "$1" "$2"
}

__adnify_shell_integration_command_line() {
  printf '\033]633;E;%s\007' "$1"
}

__adnify_shell_integration_precmd() {
  local status=$?
  __adnify_suppress_preexec=0
  if [ "${__adnify_command_running:-0}" -eq 1 ]; then
    __adnify_command_running=0
    __adnify_shell_integration_emit_with_payload D "$status"
  fi
  __adnify_shell_integration_emit A
  return "$status"
}

__adnify_shell_integration_preexec() {
  if [ "${__adnify_suppress_preexec:-0}" -eq 1 ]; then
    return 0
  fi
  __adnify_command_running=1
  __adnify_shell_integration_command_line "$1"
  __adnify_shell_integration_emit C
}

case "$ZSH_VERSION" in
  '')
    # DEBUG is the only pre-command hook available in bash. It fires for
    # nested commands and function calls too, so keep only the first boundary
    # and never restore this handler recursively.
    __adnify_shell_integration_debug() {
      [ "${__adnify_suppress_preexec:-0}" -eq 1 ] && return 0
      __adnify_suppress_preexec=1
      case "$BASH_COMMAND" in
        '__adnify_shell_integration_debug'|'__adnify_shell_integration_precmd'|'__adnify_shell_integration_preexec') ;;
        *) __adnify_shell_integration_preexec "$BASH_COMMAND" ;;
      esac
    }
    PROMPT_COMMAND="__adnify_shell_integration_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
    trap '__adnify_shell_integration_debug' DEBUG
    ;;
  *)
    autoload -Uz add-zsh-hook
    add-zsh-hook -D precmd __adnify_shell_integration_precmd
    add-zsh-hook -D preexec __adnify_shell_integration_preexec
    add-zsh-hook precmd __adnify_shell_integration_precmd
    add-zsh-hook preexec __adnify_shell_integration_preexec
    ;;
esac

__adnify_suppress_preexec=0
__adnify_shell_integration_precmd || true
