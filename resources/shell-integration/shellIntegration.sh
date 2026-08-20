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
  __adnify_command_running=1
  __adnify_shell_integration_command_line "$1"
  __adnify_shell_integration_emit C
}

case "$ZSH_VERSION" in
  '')
    # DEBUG is the only pre-command hook available in bash. It fires for every
    # nested command and function call, so this handler owns the "already
    # reported this command" latch: it checks the latch, sets it, and then calls
    # preexec. preexec itself must NOT re-check the latch — doing so made the
    # two guards interlock, so C/E/D were never emitted at all and every agent
    # command fell through to the prompt-recovery path with a null exit code.
    __adnify_shell_integration_debug() {
      [ "${__adnify_suppress_preexec:-0}" -eq 1 ] && return 0
      __adnify_suppress_preexec=1
      case "$BASH_COMMAND" in
        __adnify_shell_integration_*) ;;
        *) __adnify_shell_integration_preexec "$BASH_COMMAND" ;;
      esac
    }
    PROMPT_COMMAND="__adnify_shell_integration_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
    ;;
  *)
    autoload -Uz add-zsh-hook
    add-zsh-hook -D precmd __adnify_shell_integration_precmd
    add-zsh-hook -D preexec __adnify_shell_integration_preexec
    add-zsh-hook precmd __adnify_shell_integration_precmd
    add-zsh-hook preexec __adnify_shell_integration_preexec
    ;;
esac

# Latch starts engaged so the remainder of this script cannot be reported as a
# user command, and no command is in flight yet.
__adnify_suppress_preexec=1
__adnify_command_running=0
__adnify_shell_integration_precmd || true

# bash only: install the trap last, after the bootstrap above has run, so
# sourcing this file never emits a spurious command cycle.
case "$ZSH_VERSION" in
  '') trap '__adnify_shell_integration_debug' DEBUG ;;
esac
