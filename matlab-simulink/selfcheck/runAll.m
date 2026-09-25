function runAll()
%RUNALL 电磁赛道 Simulink 模型全部自检入口。
% 用法：matlab -batch "cd('.../matlab-simulink'); runAll"
% 任一自检不通过时以 error 结束（batch 退出码非 0）。
root = fileparts(fileparts(mfilename('fullpath')));   % 本文件在 selfcheck/ 下
addpath(root, fullfile(root,'track_lib'), fullfile(root,'geom'), ...
    fullfile(root,'field'), fullfile(root,'sensor'), fullfile(root,'control'), ...
    fullfile(root,'blocks'), fullfile(root,'selfcheck'), fullfile(root,'demo'));

fprintf('\n========== 磁场/电感环节自检（sc_field） ==========\n');
r1 = sc_field();
printResults(r1);
fprintf('\n========== 循迹闭环自检（sc_tracking） ==========\n');
r2 = sc_tracking();
printResults(r2);

allPass = all([r1{:,2}, r2{:,2}]);
if allPass, summary = '全部通过'; else, summary = '存在失败项'; end
fprintf('\n========== 汇总：%s ==========\n', summary);
if ~allPass
    error('SELFCHECK FAILED：存在未通过的自检项。');
end
end

function printResults(r)
for i = 1:size(r,1)
    if r{i,2}, mark = 'PASS'; else, mark = 'FAIL'; end
    fprintf('[%s] %s -- %s\n', mark, r{i,1}, r{i,3});
end
end
