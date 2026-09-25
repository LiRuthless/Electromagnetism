%EM_ENSURE_INIT 模型 InitFcn 回调：确保 base 工作区已有 P / TD。
% 若用户想改参数/赛道，应先在命令行运行 init(...) 再 sim——
% 本脚本只在变量缺失时兜底初始化，不覆盖用户已设好的值。
if evalin('base', 'exist(''P'',''var'')') && evalin('base', 'exist(''TD'',''var'')')
    return
end
init;
